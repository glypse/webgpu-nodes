import type { Node, Edge, Viewport } from "@xyflow/svelte";

import type {
	GraphDocument,
	GraphDocumentNode,
	GraphProject,
	HydratedGraphDocument,
	HydratedGraphProject,
} from "./graph-types";
import {
	buildGroupDescriptor,
	buildGroupInputDescriptor,
	buildGroupOutputDescriptor,
} from "./node-factories";
import { nodeRegistry } from "./registry";
import { type GroupedNode, type HandleDef, type NodeDescriptor } from "./types";

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function resolveDescriptor(
	node: GroupedNode | Node,
	definitions: Record<string, HydratedGraphDocument>,
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

		const desc = resolveDescriptor(node, {});
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

export function hydrateDocument(document: GraphDocument): HydratedGraphDocument {
	const normalised = normaliseDocument(document);

	const nodes: GroupedNode[] = normalised.nodes.map(hydrateNode);

	const edges: Edge[] = normalised.edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle,
	}));

	return {
		nodes,
		edges,
		label: normalised.label,
		locked: normalised.locked,
		viewport: normalised.viewport,
	};
}

export function hydrateProject(project: GraphProject): HydratedGraphProject {
	const root = hydrateDocument(project.root);
	const definitions = Object.fromEntries(
		Object.entries(project.definitions).map(([key, doc]) => [key, hydrateDocument(doc)]),
	);
	return { root, definitions };
}

/**
 * Serialise a single subgraph's live SvelteFlow Node[]/Edge[] back to a GraphDocument.
 * NOTE: like normaliseDocument, this is per-subgraph only. A `serialiseProject` wrapping
 * this for root + definitions + recursing into owned content is done by
 * `GraphManager.getProjectJson()`.
 */
export function serialiseDocument(
	nodes: Node[],
	edges: Edge[],
	label?: string,
	locked?: boolean,
	viewport?: Viewport,
): GraphDocument {
	return {
		nodes: nodes.map(({ id, type, data, position }) => ({
			id,
			type: type ?? "",
			data,
			position,
		})),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined,
		})),
		...(label !== undefined ? { label } : {}),
		...(locked !== undefined ? { locked } : {}),
		...(viewport !== undefined ? { viewport } : {}),
	};
}
