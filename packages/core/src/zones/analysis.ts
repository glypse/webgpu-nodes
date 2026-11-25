import {
	isZoneInput,
	isZoneOutput,
	type MinimalEdge,
	type MinimalNode,
	pairedOutputId,
	PASS_REPEAT_INPUT,
	SIMULATION_INPUT,
	type ZoneKind,
	zoneKindOf,
} from "./descriptors";

/**
 * Nodes that can never live inside a zone: the document's sinks, and a
 * simulation's start, which a loop or another frame's step can't run.
 */
const ROOT_ONLY_TYPES = new Set(["frag-output", "group-output", SIMULATION_INPUT]);

export type ZoneAnalysisOptions = {
	/**
	 * Group nodes computing a simulation zone, themselves or through groups
	 * they nest (see `simulatingDefinitions`): they can't be in a zone either.
	 */
	simulating?: ReadonlySet<string>;
	/**
	 * Group nodes computing a passes zone (see `loopingDefinitions`): they
	 * can't be in a repeat zone, which is one pixel's computation.
	 */
	looping?: ReadonlySet<string>;
};

/** What a project's zones need to know about the groups nesting them. */
export function zoneOptions(definitions: Definitions): ZoneAnalysisOptions {
	return {
		simulating: simulatingDefinitions(definitions),
		looping: loopingDefinitions(definitions),
	};
}

const REPEAT_REASON =
	"A repeat zone runs inside one pass, for each pixel: it can't repeat whole passes.";
const SIMULATION_REASON = "A simulation steps once a frame, so it can't be inside a zone.";

export type Zone = {
	/** The zone's id: its input node's id. */
	id: string;
	kind: ZoneKind;
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
	/** Zone id of every paired zone input / output node. */
	zoneOfBoundary: Map<string, string>;
	/**
	 * Innermost zone containing each node (null when outside every zone).
	 * Boundary nodes map to their own zone.
	 */
	nodeZone: Map<string, string | null>;
	/** Links breaking zone rules: drawn red, treated as disconnected by codegen. */
	invalidEdges: Set<string>;
	/** Why some of them do, by link, when it's a nesting rule. */
	reasons: Map<string, string>;
	/** Zone nodes missing their partner. */
	unpaired: Set<string>;
};

/** Edges each zone implicitly adds: its output depends on its input. */
function implicitZoneEdges(zones: Iterable<Zone>): { source: string; target: string }[] {
	return [...zones].map((z) => ({ source: z.inputId, target: z.outputId }));
}

type Definitions = ReadonlyMap<string, { nodes: readonly MinimalNode[] }>;

type HoldingEntry = { nodes: (readonly MinimalNode[])[]; result: ReadonlySet<string> };

const definitionCache = new WeakMap<Definitions, Map<string, HoldingEntry>>();

/**
 * The definitions holding a node `own` says, themselves or through the
 * groups they nest, among `definitions`. Memoised on their node arrays.
 */
function definitionsHolding(
	key: string,
	definitions: Definitions,
	own: (node: MinimalNode) => boolean,
): ReadonlySet<string> {
	const nodes = [...definitions.values()].map((d) => d.nodes);
	const caches = definitionCache.get(definitions) ?? new Map<string, HoldingEntry>();
	definitionCache.set(definitions, caches);
	const cached = caches.get(key);
	if (cached?.nodes.length === nodes.length && cached.nodes.every((n, i) => n === nodes[i])) {
		return cached.result;
	}
	const holding = new Set<string>();
	for (const [ref, doc] of definitions) {
		if (doc.nodes.some(own)) holding.add(ref);
	}
	// Grows until no definition nesting a holding one is left out.
	for (let grew = holding.size > 0; grew;) {
		grew = false;
		for (const [ref, doc] of definitions) {
			if (holding.has(ref)) continue;
			if (doc.nodes.some((n) => n.group && holding.has(n.group.definitionRef))) {
				holding.add(ref);
				grew = true;
			}
		}
	}
	caches.set(key, { nodes, result: holding });
	return holding;
}

/**
 * The definitions computing a simulation zone, themselves or through the
 * groups they nest, among `definitions`. Memoised on their node arrays.
 */
export function simulatingDefinitions(definitions: Definitions): ReadonlySet<string> {
	return definitionsHolding("simulating", definitions, (n) => n.type === SIMULATION_INPUT);
}

/** The definitions computing a passes zone, as `simulatingDefinitions` does for simulations. */
export function loopingDefinitions(definitions: Definitions): ReadonlySet<string> {
	return definitionsHolding("looping", definitions, (n) => n.type === PASS_REPEAT_INPUT);
}

/**
 * Whether a link `source → target` would close a cycle, accounting for the
 * implicit zone input → zone output dependency of every zone.
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
	const outputs = new Set(nodes.filter((n) => isZoneOutput(n.type)).map((n) => n.id));
	for (const n of nodes) {
		const out = pairedOutputId(n);
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

type MemoEntry = {
	edges: readonly MinimalEdge[];
	options: ZoneAnalysisOptions;
	analysis: ZoneAnalysis;
};

const analyses = new WeakMap<readonly MinimalNode[], MemoEntry>();

/**
 * The zones of a document, derived from its nodes and edges and memoised on
 * their arrays, which edits replace: codegen asks for them in every pass.
 */
export function analyzeZones(
	nodes: readonly MinimalNode[],
	edges: readonly MinimalEdge[],
	options: ZoneAnalysisOptions = {},
): ZoneAnalysis {
	const known = analyses.get(nodes);
	if (
		known?.edges === edges &&
		known.options.simulating === options.simulating &&
		known.options.looping === options.looping
	) {
		return known.analysis;
	}
	const analysis = computeZones(nodes, edges, options);
	analyses.set(nodes, { edges, options, analysis });
	return analysis;
}

/**
 * Work out zone membership, nesting and invalid links for one document,
 * following Blender's rules (blenkernel/intern/node_tree_zones.cc):
 *
 * - "inside" flags propagate forward along links: a zone input sets its
 *   zone's flag; a zone output inherits its input's flags (implicit link),
 *   clears its own zone and marks downstream nodes as "after" the zone.
 * - A node can't be both inside and after the same zone, nor inside two
 *   unrelated zones, and sinks (frag-output, group-output) are always
 *   outside, as are simulation zones (and groups computing one): the
 *   incoming links causing such conflicts are invalid. Unlike Blender (which
 *   rejects the whole tree), only those links are dropped and the analysis
 *   is re-run until it is stable.
 * - Remaining links may only stay in a zone or enter a nested one, never leave.
 */
function computeZones(
	nodes: readonly MinimalNode[],
	edges: readonly MinimalEdge[],
	{ simulating, looping }: ZoneAnalysisOptions = {},
): ZoneAnalysis {
	const rootOnly = (node: MinimalNode | undefined): boolean =>
		ROOT_ONLY_TYPES.has(node?.type ?? "") ||
		(!!node?.group && !!simulating?.has(node.group.definitionRef));
	/** Whether a node repeats passes, which a repeat zone's loop can't contain. */
	const repeatsPasses = (node: MinimalNode | undefined): boolean =>
		node?.type === PASS_REPEAT_INPUT ||
		(!!node?.group && !!looping?.has(node.group.definitionRef));
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const zones = new Map<string, Zone>();
	const zoneOfBoundary = new Map<string, string>();
	const unpaired = new Set<string>();
	/** Why the nodes that can't be where their links put them can't be. */
	const refused = new Map<string, string>();

	// 1. Pair boundary nodes.
	const claimedOutputs = new Set<string>();
	for (const node of nodes) {
		if (!isZoneInput(node.type)) continue;
		const kind = zoneKindOf(node.type) ?? "repeat";
		const outputId = pairedOutputId(node);
		const output = outputId ? nodeById.get(outputId) : undefined;
		if (
			!outputId ||
			!isZoneOutput(output?.type) ||
			zoneKindOf(output?.type) !== kind ||
			claimedOutputs.has(outputId)
		) {
			unpaired.add(node.id);
			continue;
		}
		claimedOutputs.add(outputId);
		const zone: Zone = {
			id: node.id,
			kind,
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
		if (isZoneOutput(node.type) && !claimedOutputs.has(node.id)) unpaired.add(node.id);
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
			if (rootOnly(node)) {
				if (ins.size > 0 && node?.type !== "frag-output" && node?.type !== "group-output") {
					refused.set(id, SIMULATION_REASON);
				}
				ins.clear();
			}
			if (repeatsPasses(node)) {
				for (const z of ins) {
					if (zones.get(z)?.kind !== "repeat") continue;
					ins.delete(z);
					refused.set(id, REPEAT_REASON);
				}
			}
			if (id === zone?.inputId) ins.add(zone.id);
			if (id === zone?.outputId) {
				for (const z of inside.get(zone.inputId) ?? []) ins.add(z);
				ins.delete(zone.id);
				aft.add(zone.id);
			}

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
			// A zone output inherits its input's flags through the implicit link.
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

	const reasons = new Map<string, string>();
	for (const id of invalidEdges) {
		const edge = edges.find((e) => e.id === id);
		const reason = edge && refused.get(edge.target);
		if (reason) reasons.set(id, reason);
	}
	return { zones, zoneOfBoundary, nodeZone, invalidEdges, reasons, unpaired };
}
