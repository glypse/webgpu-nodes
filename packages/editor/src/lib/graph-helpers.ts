import type { Node, Viewport } from "@xyflow/svelte";

import type {
	GraphDocument,
	GraphDocumentNode,
	GraphProject,
	HydratedEdge,
	HydratedGraphProject,
} from "./graph-types";
import { HydratedGraphDocument } from "./hydrated-document.svelte";
import {
	buildGroupDescriptor,
	buildGroupInputDescriptor,
	buildGroupOutputDescriptor,
} from "./node-factories";
import { nodeRegistry } from "./registry";
import { type GroupedNode, type HandleDef, type NodeDescriptor } from "./types";
import {
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	buildRepeatInputDescriptor,
	buildRepeatOutputDescriptor,
} from "./zones";

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function resolveDescriptor(
	node: GroupedNode | Node,
	definitions: Map<string, HydratedGraphDocument>,
): NodeDescriptor {
	if (node.type === "group-input") {
		return buildGroupInputDescriptor((node.data.handles ?? []) as HandleDef[]);
	}
	if (node.type === "group-output") {
		return buildGroupOutputDescriptor((node.data.handles ?? []) as HandleDef[]);
	}
	if (node.type === "node-group") {
		return buildGroupDescriptor(node, definitions);
	}
	if (node.type === REPEAT_INPUT) {
		return buildRepeatInputDescriptor(node, definitions);
	}
	if (node.type === REPEAT_OUTPUT) {
		return buildRepeatOutputDescriptor(node);
	}
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- fallback is safe
	return (nodeRegistry[node.type ?? ""] ?? nodeRegistry.float)!;
}

export function normaliseDocument(doc: GraphDocument): GraphDocument {
	const nodes: GraphDocumentNode[] = [];
	for (const node of doc.nodes) {
		if (node.group) {
			nodes.push({ ...node, data: { ...node.data } });
			continue;
		}

		const desc = resolveDescriptor(node, new Map());
		nodes.push({ ...node, data: { ...desc.defaultData, ...node.data } });
	}
	const result: GraphDocument = { nodes, edges: doc.edges, label: doc.label, locked: doc.locked };
	if (doc.viewport) result.viewport = doc.viewport;
	return result;
}

const NON_DELETABLE_TYPES = new Set(["frag-output", "group-input", "group-output"]);

function hydrateNode(node: GraphDocumentNode): GroupedNode {
	const base = {
		id: node.id,
		type: node.type,
		data: node.data,
		position: node.position,
		deletable: NON_DELETABLE_TYPES.has(node.type) ? false : undefined,
	};

	if (node.group) {
		return {
			...base,
			group: node.group, // just a string pointer, nothing to hydrate
		};
	}

	return base; // not a group node at all - most nodes hit this line
}

/** Build indexed Maps from nodes and edges arrays. */
export function buildDocumentIndex(
	nodes: GroupedNode[],
	edges: HydratedEdge[],
): {
	nodesById: Map<string, GroupedNode>;
	edgesBySource: Map<string, HydratedEdge[]>;
	edgesByTarget: Map<string, HydratedEdge[]>;
} {
	const nodesById = new Map<string, GroupedNode>();
	for (const node of nodes) {
		nodesById.set(node.id, node);
	}

	const edgesBySource = new Map<string, HydratedEdge[]>();
	const edgesByTarget = new Map<string, HydratedEdge[]>();
	for (const edge of edges) {
		const sourceList = edgesBySource.get(edge.source);
		if (sourceList) {
			sourceList.push(edge);
		} else {
			edgesBySource.set(edge.source, [edge]);
		}
		const targetList = edgesByTarget.get(edge.target);
		if (targetList) {
			targetList.push(edge);
		} else {
			edgesByTarget.set(edge.target, [edge]);
		}
	}

	return { nodesById, edgesBySource, edgesByTarget };
}

export function hydrateDocument(document: GraphDocument): HydratedGraphDocument {
	const normalised = normaliseDocument(document);

	const nodes: GroupedNode[] = normalised.nodes.map(hydrateNode);

	const edges: HydratedEdge[] = normalised.edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle,
	}));

	const { nodesById, edgesBySource, edgesByTarget } = buildDocumentIndex(nodes, edges);

	const doc = new HydratedGraphDocument();
	doc.nodes = nodes;
	doc.edges = edges;
	doc.nodesById = nodesById;
	doc.edgesBySource = edgesBySource;
	doc.edgesByTarget = edgesByTarget;
	doc.label = normalised.label;
	doc.locked = normalised.locked ?? false;
	doc.viewport = normalised.viewport;
	return doc;
}

export function hydrateProject(project: GraphProject): HydratedGraphProject {
	const definitions = new Map<string, HydratedGraphDocument>();
	for (const [key, doc] of Object.entries(project.definitions)) {
		definitions.set(key, hydrateDocument(doc));
	}
	return { definitions };
}

/**
 * Serialise a single subgraph's live SvelteFlow Node[]/Edge[] back to a GraphDocument.
 * NOTE: like normaliseDocument, this is per-subgraph only. A `serialiseProject` wrapping
 * this for root + definitions + recursing into owned content is done by
 * `GraphManager.getProjectJson()`.
 */
export function serialiseDocument(
	nodes: Node[],
	edges: HydratedEdge[],
	label?: string,
	locked?: boolean,
	viewport?: Viewport,
): GraphDocument {
	return {
		nodes: nodes.map((n) => {
			const { id, type, data, position } = n;
			const group = (n as GroupedNode).group;
			return {
				id,
				type: type ?? "",
				data,
				position,
				...(group ? { group } : {}),
			};
		}),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle,
		})),
		...(label !== undefined ? { label } : {}),
		...(locked !== undefined ? { locked } : {}),
		...(viewport !== undefined ? { viewport } : {}),
	};
}
