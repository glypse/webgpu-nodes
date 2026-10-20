import {
	buildGroupDescriptor,
	buildGroupInputDescriptor,
	buildGroupOutputDescriptor,
} from "../nodes/groups";
import { nodeRegistry } from "../nodes/registry";
import { type HandleDef, type NodeDescriptor } from "../types";
import {
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	buildRepeatInputDescriptor,
	buildRepeatOutputDescriptor,
} from "../zones";
import {
	type GraphDocument,
	type GraphDocumentEdge,
	type GraphDocumentNode,
	type GraphEdge,
	type GraphNode,
	type GraphProject,
	type HydratedGraphDocument,
	type HydratedGraphProject,
	createPlainDocument,
} from "./document";

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function resolveDescriptor(
	node: GraphNode,
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

function hydrateNode(node: GraphDocumentNode): GraphNode {
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
	nodes: GraphNode[],
	edges: GraphEdge[],
): Pick<HydratedGraphDocument, "nodesById" | "edgesBySource" | "edgesByTarget"> {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const edgesBySource = new Map<string, GraphEdge[]>();
	const edgesByTarget = new Map<string, GraphEdge[]>();
	for (const edge of edges) {
		pushTo(edgesBySource, edge.source, edge);
		pushTo(edgesByTarget, edge.target, edge);
	}
	return { nodesById, edgesBySource, edgesByTarget };
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** Rebuild a document's lookup indexes after its nodes or edges were reassigned. */
export function indexDocument(doc: HydratedGraphDocument): void {
	Object.assign(doc, buildDocumentIndex(doc.nodes, doc.edges));
}

/** Creates the in-memory form of a document (plain, or reactive in a front end). */
export type DocumentFactory = () => HydratedGraphDocument;

export function hydrateDocument(
	document: GraphDocument,
	create: DocumentFactory = createPlainDocument,
): HydratedGraphDocument {
	const normalised = normaliseDocument(document);
	const doc = create();
	doc.nodes = normalised.nodes.map(hydrateNode);
	doc.edges = normalised.edges.map(serialiseEdge);
	indexDocument(doc);
	doc.label = normalised.label;
	doc.locked = normalised.locked ?? false;
	doc.viewport = normalised.viewport;
	return doc;
}

export function hydrateProject(
	project: GraphProject,
	create: DocumentFactory = createPlainDocument,
): HydratedGraphProject {
	const definitions = new Map<string, HydratedGraphDocument>();
	for (const [key, doc] of Object.entries(project.definitions)) {
		definitions.set(key, hydrateDocument(doc, create));
	}
	return { definitions };
}

/** The serialisable part of a node (UI-only fields dropped, data shared). */
export function serialiseNode(node: GraphNode): GraphDocumentNode {
	const { id, type, data, position, group } = node;
	return { id, type: type ?? "", data, position, ...(group ? { group } : {}) };
}

/** The serialisable part of an edge. */
export function serialiseEdge(edge: GraphDocumentEdge): GraphDocumentEdge {
	const { id, source, target, sourceHandle, targetHandle } = edge;
	return { id, source, target, sourceHandle, targetHandle };
}

/** Serialise one hydrated subgraph back to a GraphDocument, camera optional. */
export function serialiseDocument(
	doc: Pick<HydratedGraphDocument, "nodes" | "edges" | "label" | "locked" | "viewport">,
	{ viewport = false }: { viewport?: boolean } = {},
): GraphDocument {
	return {
		nodes: doc.nodes.map(serialiseNode),
		edges: doc.edges.map(serialiseEdge),
		...(doc.label !== undefined ? { label: doc.label } : {}),
		locked: doc.locked,
		...(viewport && doc.viewport ? { viewport: doc.viewport } : {}),
	};
}
