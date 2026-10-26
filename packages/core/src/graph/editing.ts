import type { GroupHandleDef, NodeData } from "../types";
import type { TypeResolver } from "../types/resolver";
import type {
	GraphDocumentEdge,
	GraphDocumentNode,
	GraphNode,
	HydratedGraphDocument,
} from "./document";

/** Node types delimiting a group's subgraph. */
export const BOUNDARY_TYPES: ReadonlySet<string> = new Set(["group-input", "group-output"]);

/** The handles declared on a group boundary node. */
export function handlesOf(node: { data: NodeData } | undefined): GroupHandleDef[] {
	return node?.data.handles ?? [];
}

/** Definitions referenced by the group nodes of a document. */
export function groupRefsOf(doc: Pick<HydratedGraphDocument, "nodes">): string[] {
	return doc.nodes.flatMap((n) =>
		n.type === "node-group" && n.group ? [n.group.definitionRef] : [],
	);
}

/**
 * Deep-copy node data, pointing a Repeat Input at its partner's new id when
 * nodes are cloned with fresh ids.
 */
export function remapZonePairing(data: NodeData, idMap: Map<string, string>): NodeData {
	const copy = structuredClone(data);
	const paired = copy.pairedOutput === undefined ? undefined : idMap.get(copy.pairedOutput);
	if (paired) copy.pairedOutput = paired;
	return copy;
}

/** JSON with object keys sorted, so equal content always serialises equally. */
export function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) => {
		if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
		const entries = Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return Object.fromEntries(entries);
	});
}

/**
 * Copy nodes and the edges between them with fresh ids (keeping zone
 * pairings), shifted by `offset`. Returns the copies and the id mapping.
 */
export function cloneSubgraph(
	nodes: readonly GraphNode[],
	edges: readonly GraphDocumentEdge[],
	offset = { x: 0, y: 0 },
): { nodes: GraphDocumentNode[]; edges: GraphDocumentEdge[]; idMap: Map<string, string> } {
	const idMap = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
	const remap = (id: string) => idMap.get(id) ?? id;
	return {
		nodes: nodes.map((n) => ({
			id: remap(n.id),
			type: n.type ?? "",
			data: remapZonePairing(n.data, idMap),
			position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
			...(n.group ? { group: { ...n.group } } : {}),
		})),
		edges: edges
			.filter((e) => idMap.has(e.source) && idMap.has(e.target))
			.map((e) => ({
				id: crypto.randomUUID(),
				source: remap(e.source),
				target: remap(e.target),
				sourceHandle: e.sourceHandle,
				targetHandle: e.targetHandle,
			})),
		idMap,
	};
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export function computeSelectionBounds(selectedNodes: GraphNode[]) {
	const lefts = selectedNodes.map((n) => n.position.x);
	const tops = selectedNodes.map((n) => n.position.y);
	const rights = selectedNodes.map((n) => n.position.x + (n.width ?? 0));
	const bottoms = selectedNodes.map((n) => n.position.y + (n.height ?? 0));

	const minX = Math.min(...lefts);
	const maxX = Math.max(...rights);
	const minY = Math.min(...tops);
	const maxY = Math.max(...bottoms);

	return {
		centerX: (minX + maxX) / 2,
		centerY: (minY + maxY) / 2,
		minX,
		maxX,
	};
}

export type ClassifiedEdges = {
	internal: GraphDocumentEdge[];
	incoming: GraphDocumentEdge[];
	outgoing: GraphDocumentEdge[];
};

export function classifyEdges(
	selectedNodeIds: Set<string>,
	edges: GraphDocumentEdge[],
): ClassifiedEdges {
	const internal = edges.filter(
		(edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
	);
	const incoming = edges.filter(
		(edge) => !selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
	);
	const outgoing = edges.filter(
		(edge) => selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
	);

	return { internal, incoming, outgoing };
}

export function deduplicateBySource(edgesToGroup: GraphDocumentEdge[]): GraphDocumentEdge[][] {
	const groups = new Map<string, GraphDocumentEdge[]>();

	for (const edge of edgesToGroup) {
		const key = `${edge.source}::${edge.sourceHandle}`;

		const existing = groups.get(key);
		if (existing) {
			existing.push(edge);
		} else {
			groups.set(key, [edge]);
		}
	}

	return [...groups.values()];
}

export type BoundaryBuildResult = {
	node: GraphDocumentNode;
	handleFor: Map<GraphDocumentEdge[], GroupHandleDef>;
};

export function buildBoundaryNode(
	direction: "input" | "output",
	deduped: GraphDocumentEdge[][],
	typeResolver: TypeResolver,
	resolveNode: (id: string) => GraphNode | undefined,
	position: { x: number; y: number },
): BoundaryBuildResult {
	const handleFor = new Map<GraphDocumentEdge[], GroupHandleDef>();
	const handles: GroupHandleDef[] = [];
	const prefix = direction === "input" ? "Input" : "Output";
	const nodeType = direction === "input" ? "group-input" : "group-output";

	for (const [i, group] of deduped.entries()) {
		const representative = group[0];
		if (!representative) {
			console.warn("[graph] empty edge group - skipping");
			continue;
		}
		const handle: GroupHandleDef = {
			id: crypto.randomUUID(),
			label: `${prefix} ${String(i + 1)}`,
			type: typeResolver.inferHandleType(representative, resolveNode),
		};
		handles.push(handle);
		handleFor.set(group, handle);
	}

	return {
		node: {
			id: crypto.randomUUID(),
			type: nodeType,
			data: { handles },
			position,
		},
		handleFor,
	};
}

export function rewireIncomingGroup(
	group: GraphDocumentEdge[],
	handle: GroupHandleDef,
	groupInputNodeId: string,
	groupNodeId: string,
): { outer: GraphDocumentEdge; inner: GraphDocumentEdge[] } {
	const representative = group[0];
	if (!representative) throw new Error("empty group");

	const outer: GraphDocumentEdge = {
		id: crypto.randomUUID(),
		source: representative.source,
		sourceHandle: representative.sourceHandle,
		target: groupNodeId,
		targetHandle: handle.id,
	};

	const inner: GraphDocumentEdge[] = group.map((edge) => ({
		id: crypto.randomUUID(),
		source: groupInputNodeId,
		sourceHandle: handle.id,
		target: edge.target,
		targetHandle: edge.targetHandle,
	}));

	return { outer, inner };
}

export function rewireOutgoingGroup(
	group: GraphDocumentEdge[],
	handle: GroupHandleDef,
	groupOutputNodeId: string,
	groupNodeId: string,
): { outer: GraphDocumentEdge[]; inner: GraphDocumentEdge } {
	const representative = group[0];
	if (!representative) throw new Error("empty group");

	const inner: GraphDocumentEdge = {
		id: crypto.randomUUID(),
		source: representative.source,
		sourceHandle: representative.sourceHandle,
		target: groupOutputNodeId,
		targetHandle: handle.id,
	};

	const outer: GraphDocumentEdge[] = group.map((edge) => ({
		id: crypto.randomUUID(),
		source: groupNodeId,
		sourceHandle: handle.id,
		target: edge.target,
		targetHandle: edge.targetHandle,
	}));

	return { outer, inner };
}
