import type { HydratedGraphDocument } from "./hydrated-document.svelte";
import { type HandleDef, type NodeDescriptor, isWgslType } from "./types";

// ── Repeat zones ─────────────────────────────────────────────────────────────
//
// A repeat zone is a pair of nodes, like Blender's geometry-nodes repeat zone:
//
//   Repeat Input  ── inputs:  iterations, initial value of every state item
//                 └─ outputs: iteration index, current value of every item
//   Repeat Output ── inputs:  next value of every item
//                 └─ outputs: final value of every item
//
// The output node owns the item list (`data.items`); the input node points at
// its partner with `data.pairedOutput`. Item handle ids are shared by both
// nodes.
//
// Which nodes are *inside* a zone is derived from the links, never stored:
// anything downstream of the Repeat Input is evaluated once per iteration;
// nodes only feeding the zone are loop invariants evaluated once before the
// loop. See `analyzeZones`.

export const REPEAT_INPUT = "repeat-input";
export const REPEAT_OUTPUT = "repeat-output";
export const ZONE_NODE_TYPES: readonly string[] = [REPEAT_INPUT, REPEAT_OUTPUT];

/** Repeat Input's iteration count input. */
export const ITERATIONS_HANDLE = "iterations";
/** Repeat Input's current-iteration-index output. */
export const ITERATION_HANDLE = "iteration";
/** Virtual handle: dropping a link on it creates a new state item. */
export const NEW_ITEM_HANDLE = "__new_item__";

export const DEFAULT_ITERATIONS = 1;
export const DEFAULT_MAX_ITERATIONS = 1024;

/** Nodes that can never live inside a zone (they are the document's sinks). */
const ROOT_ONLY_TYPES = new Set(["frag-output", "group-output"]);

type MinimalNode = { id: string; type?: string; data: Record<string, unknown> };
type MinimalEdge = { id: string; source: string; target: string };

export function isZoneNodeType(type: string | undefined): boolean {
	return type === REPEAT_INPUT || type === REPEAT_OUTPUT;
}

/** The id of the Repeat Output a Repeat Input is paired with. */
export function pairedOutputId(node: MinimalNode): string | undefined {
	const id = node.data.pairedOutput;
	return typeof id === "string" ? id : undefined;
}

/** The state items declared on a Repeat Output node (validated). */
export function zoneItems(outputNode: MinimalNode | undefined): HandleDef[] {
	const raw = outputNode?.data.items;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(item): item is HandleDef =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as HandleDef).id === "string" &&
			typeof (item as HandleDef).label === "string" &&
			isWgslType((item as HandleDef).type),
	);
}

/** The safety cap applied to a zone's iteration count. */
export function zoneMaxIterations(inputNode: MinimalNode): number {
	const raw = Number(inputNode.data.maxIterations);
	return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : DEFAULT_MAX_ITERATIONS;
}

/** Find a node by id in any document of the project. */
function findNode(
	id: string | undefined,
	definitions: Map<string, HydratedGraphDocument>,
): MinimalNode | undefined {
	if (!id) return undefined;
	for (const doc of definitions.values()) {
		const node = doc.nodesById.get(id);
		if (node) return node;
	}
	return undefined;
}

/** Find the Repeat Input paired with a Repeat Output, in any document. */
export function findPairedInput(
	outputId: string,
	definitions: Map<string, HydratedGraphDocument>,
): MinimalNode | undefined {
	for (const doc of definitions.values()) {
		if (!doc.nodesById.has(outputId)) continue;
		return doc.nodes.find((n) => n.type === REPEAT_INPUT && pairedOutputId(n) === outputId);
	}
	return undefined;
}

function zoneDescriptorBase(
	type: string,
	label: string,
): Omit<NodeDescriptor, "inputs" | "outputs"> {
	return {
		type,
		label,
		category: "zone",
		hidden: true,
		staticOutputTypes: true,
		defaultData: {},
		wgsl: () => {
			throw new Error("zone boundaries are emitted structurally by codegen");
		},
	};
}

export function buildRepeatInputDescriptor(
	node: MinimalNode,
	definitions: Map<string, HydratedGraphDocument>,
): NodeDescriptor {
	const items = zoneItems(findNode(pairedOutputId(node), definitions));
	return {
		...zoneDescriptorBase(REPEAT_INPUT, "Repeat Input"),
		defaultData: { iterations: DEFAULT_ITERATIONS, maxIterations: DEFAULT_MAX_ITERATIONS },
		inputs: [
			{ id: ITERATIONS_HANDLE, label: "Iterations", types: ["i32"] },
			...items.map((item) => ({ id: item.id, label: item.label, types: [item.type] })),
		],
		outputs: [
			{ id: ITERATION_HANDLE, label: "Iteration", type: "i32" },
			...items.map((item) => ({ id: item.id, label: item.label, type: item.type })),
		],
	};
}

export function buildRepeatOutputDescriptor(node: MinimalNode): NodeDescriptor {
	const items = zoneItems(node);
	return {
		...zoneDescriptorBase(REPEAT_OUTPUT, "Repeat Output"),
		defaultData: { items: [] },
		inputs: items.map((item) => ({ id: item.id, label: item.label, types: [item.type] })),
		outputs: items.map((item) => ({ id: item.id, label: item.label, type: item.type })),
	};
}

// ── Zone analysis ────────────────────────────────────────────────────────────

export type Zone = {
	/** The zone's id: its Repeat Input node id. */
	id: string;
	inputId: string;
	outputId: string;
	/** Id of the directly enclosing zone, or null at the document's top level. */
	parent: string | null;
	/** 0 for top-level zones. */
	depth: number;
	/** Every node inside the zone (nested zones included), boundaries excluded. */
	members: Set<string>;
};

export type ZoneAnalysis = {
	zones: Map<string, Zone>;
	/** Zone id of every paired Repeat Input / Repeat Output node. */
	zoneOfBoundary: Map<string, string>;
	/**
	 * Innermost zone containing each node (null when outside every zone).
	 * Boundary nodes map to their own zone.
	 */
	nodeZone: Map<string, string | null>;
	/** Links breaking zone rules: drawn red, treated as disconnected by codegen. */
	invalidEdges: Set<string>;
	/** Zone nodes missing their partner. */
	unpaired: Set<string>;
};

/** Edges each zone implicitly adds: its output depends on its input. */
function implicitZoneEdges(zones: Iterable<Zone>): { source: string; target: string }[] {
	return [...zones].map((z) => ({ source: z.inputId, target: z.outputId }));
}

/**
 * Whether a link `source → target` would close a cycle, accounting for the
 * implicit Repeat Input → Repeat Output dependency of every zone.
 */
export function wouldCreateCycle(
	nodes: readonly MinimalNode[],
	edges: readonly { source: string; target: string }[],
	source: string,
	target: string,
): boolean {
	if (source === target) return true;
	const adjacency = new Map<string, string[]>();
	const link = (from: string, to: string) => {
		const list = adjacency.get(from) ?? [];
		list.push(to);
		adjacency.set(from, list);
	};
	for (const e of edges) link(e.source, e.target);
	const outputs = new Set(nodes.filter((n) => n.type === REPEAT_OUTPUT).map((n) => n.id));
	for (const n of nodes) {
		const out = n.type === REPEAT_INPUT ? pairedOutputId(n) : undefined;
		if (out && outputs.has(out)) link(n.id, out);
	}
	// Is `source` reachable from `target`?
	const seen = new Set<string>([target]);
	const stack = [target];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		if (current === source) return true;
		for (const next of adjacency.get(current) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				stack.push(next);
			}
		}
	}
	return false;
}

/** Topological order of `ids`; nodes caught in a cycle are appended last. */
function topoOrder(ids: string[], edges: { source: string; target: string }[]): string[] {
	const inDegree = new Map(ids.map((id) => [id, 0]));
	const adjacency = new Map<string, string[]>();
	for (const e of edges) {
		if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue;
		adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
		inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
	}
	const queue = ids.filter((id) => inDegree.get(id) === 0);
	const order: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift();
		if (id === undefined) break;
		order.push(id);
		for (const next of adjacency.get(id) ?? []) {
			const degree = (inDegree.get(next) ?? 0) - 1;
			inDegree.set(next, degree);
			if (degree === 0) queue.push(next);
		}
	}
	const placed = new Set(order);
	return [...order, ...ids.filter((id) => !placed.has(id))];
}

/**
 * Work out zone membership, nesting and invalid links for one document,
 * following Blender's rules (blenkernel/intern/node_tree_zones.cc):
 *
 * - "inside" flags propagate forward along links: a Repeat Input sets its
 *   zone's flag; a Repeat Output inherits its input's flags (implicit link),
 *   clears its own zone and marks downstream nodes as "after" the zone.
 * - A node can't be both inside and after the same zone, nor inside two
 *   unrelated zones, and sinks (frag-output, group-output) are always outside:
 *   the incoming links causing such conflicts are invalid. Unlike Blender
 *   (which rejects the whole tree), only those links are dropped and the
 *   analysis is re-run until it is stable.
 * - Remaining links may only stay in a zone or enter a nested one, never leave.
 */
export function analyzeZones(
	nodes: readonly MinimalNode[],
	edges: readonly MinimalEdge[],
): ZoneAnalysis {
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const zones = new Map<string, Zone>();
	const zoneOfBoundary = new Map<string, string>();
	const unpaired = new Set<string>();

	// 1. Pair boundary nodes.
	const claimedOutputs = new Set<string>();
	for (const node of nodes) {
		if (node.type !== REPEAT_INPUT) continue;
		const outputId = pairedOutputId(node);
		const output = outputId ? nodeById.get(outputId) : undefined;
		if (!outputId || output?.type !== REPEAT_OUTPUT || claimedOutputs.has(outputId)) {
			unpaired.add(node.id);
			continue;
		}
		claimedOutputs.add(outputId);
		const zone: Zone = {
			id: node.id,
			inputId: node.id,
			outputId,
			parent: null,
			depth: 0,
			members: new Set(),
		};
		zones.set(zone.id, zone);
		zoneOfBoundary.set(node.id, zone.id);
		zoneOfBoundary.set(outputId, zone.id);
	}
	for (const node of nodes) {
		if (node.type === REPEAT_OUTPUT && !claimedOutputs.has(node.id)) unpaired.add(node.id);
	}

	// Links touching an unpaired zone node carry no meaning.
	const invalidEdges = new Set<string>();
	for (const e of edges) {
		if (unpaired.has(e.source) || unpaired.has(e.target)) invalidEdges.add(e.id);
	}

	const ids = nodes.map((n) => n.id);
	const implicit = implicitZoneEdges(zones.values());
	let inside = new Map<string, Set<string>>();
	let ancestors = new Map<string, Set<string>>();

	/** Zones containing `zoneId` (from its output's inside flags). */
	const enclosing = (zoneId: string): Set<string> => {
		const zone = zones.get(zoneId);
		return (zone && inside.get(zone.outputId)) ?? new Set();
	};

	/** Innermost zone of a flag set: the one with the most enclosing zones. */
	const innermost = (flags: Set<string>): string | null => {
		let best: string | null = null;
		let bestDepth = -1;
		for (const z of [...flags].toSorted()) {
			const depth = enclosing(z).size;
			if (depth > bestDepth) {
				best = z;
				bestDepth = depth;
			}
		}
		return best;
	};

	// 2. Propagate flags until no new link has to be invalidated.
	for (let pass = 0; pass <= edges.length; pass++) {
		const valid = edges.filter((e) => !invalidEdges.has(e.id));
		const incoming = new Map<string, MinimalEdge[]>();
		for (const e of valid) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);

		inside = new Map();
		const after = new Map<string, Set<string>>();
		const newlyInvalid: string[] = [];

		for (const id of topoOrder(ids, [...valid, ...implicit])) {
			const node = nodeById.get(id);
			const ins = new Set<string>();
			const aft = new Set<string>();
			for (const e of incoming.get(id) ?? []) {
				for (const z of inside.get(e.source) ?? []) ins.add(z);
				for (const z of after.get(e.source) ?? []) aft.add(z);
			}
			const zoneId = zoneOfBoundary.get(id);
			const zone = zoneId ? zones.get(zoneId) : undefined;
			if (id === zone?.inputId) ins.add(zone.id);
			if (id === zone?.outputId) {
				for (const z of inside.get(zone.inputId) ?? []) ins.add(z);
				ins.delete(zone.id);
				aft.add(zone.id);
			}
			if (ROOT_ONLY_TYPES.has(node?.type ?? "")) ins.clear();

			// Inside and after the same zone: the links bringing the inside
			// flag in are the culprits.
			for (const z of ins) {
				if (!aft.has(z)) continue;
				for (const e of incoming.get(id) ?? []) {
					if (inside.get(e.source)?.has(z)) newlyInvalid.push(e.id);
				}
			}
			inside.set(id, ins);
			after.set(id, aft);
		}

		// Inside two unrelated zones: keep the innermost chain, drop links
		// bringing in foreign zones.
		ancestors = new Map();
		for (const zone of zones.values()) ancestors.set(zone.id, enclosing(zone.id));
		for (const id of ids) {
			const own = zoneOfBoundary.get(id);
			const flags = new Set(inside.get(id) ?? []);
			if (own) flags.delete(own);
			const keep = innermost(flags);
			if (!keep) continue;
			const chain = new Set([keep, ...(ancestors.get(keep) ?? [])]);
			const foreign = [...flags].filter((z) => !chain.has(z));
			if (foreign.length === 0) continue;
			const suspects = [...(incoming.get(id) ?? [])];
			// A Repeat Output inherits its input's flags through the implicit link.
			const zone = own ? zones.get(own) : undefined;
			if (id === zone?.outputId) suspects.push(...(incoming.get(zone.inputId) ?? []));
			for (const e of suspects) {
				if (foreign.some((z) => inside.get(e.source)?.has(z))) newlyInvalid.push(e.id);
			}
		}

		if (newlyInvalid.length === 0) break;
		for (const id of newlyInvalid) invalidEdges.add(id);
	}

	// 3. Nesting, depth and membership.
	for (const zone of zones.values()) {
		const outer = ancestors.get(zone.id) ?? new Set();
		zone.parent = innermost(outer);
		zone.depth = outer.size;
	}
	const nodeZone = new Map<string, string | null>();
	for (const id of ids) {
		const own = zoneOfBoundary.get(id);
		if (own) {
			nodeZone.set(id, own);
			continue;
		}
		const zoneId = innermost(inside.get(id) ?? new Set());
		nodeZone.set(id, zoneId);
		for (let z = zoneId; z; z = zones.get(z)?.parent ?? null) zones.get(z)?.members.add(id);
	}
	for (const zone of zones.values()) {
		for (let z = zone.parent; z; z = zones.get(z)?.parent ?? null) {
			zones.get(z)?.members.add(zone.inputId);
			zones.get(z)?.members.add(zone.outputId);
		}
	}

	// 4. Links may stay in a zone or enter nested zones, never leave one.
	const contains = (outer: string, inner: string | null): boolean => {
		for (let z = inner; z; z = zones.get(z)?.parent ?? null) if (z === outer) return true;
		return false;
	};
	const sourceZone = (id: string): string | null => {
		const zone = zones.get(zoneOfBoundary.get(id) ?? "");
		if (id === zone?.outputId) return zone.parent;
		return nodeZone.get(id) ?? null;
	};
	const targetZone = (id: string): string | null => {
		const zone = zones.get(zoneOfBoundary.get(id) ?? "");
		if (id === zone?.inputId) return zone.parent;
		return nodeZone.get(id) ?? null;
	};
	for (const e of edges) {
		if (invalidEdges.has(e.id)) continue;
		const from = sourceZone(e.source);
		if (from && !contains(from, targetZone(e.target))) invalidEdges.add(e.id);
	}

	return { zones, zoneOfBoundary, nodeZone, invalidEdges, unpaired };
}
