import { getContext, setContext } from "svelte";
import type { Node, Edge } from "@xyflow/svelte";
import { nodeRegistry } from "./registry";
import defaultScene from "./sizing_circle.json";

// ── Serialisable document types ──────────────────────────────────────────────

export type GraphDocument = {
	nodes: GraphDocumentNode[];
	edges: GraphDocumentEdge[];
};

export type GraphDocumentNode = {
	id: string;
	type: string;
	data: Record<string, unknown>;
	position: { x: number; y: number };
};

export type GraphDocumentEdge = {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
};

export function isGraphDocument(obj: unknown): obj is GraphDocument {
	return typeof obj === "object" && obj !== null && "nodes" in obj && "edges" in obj;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Normalise a document: fill in defaultData for any node that's missing fields,
 * discard unknown node types, etc.
 */
export function normaliseDocument(doc: GraphDocument): GraphDocument {
	const nodes: GraphDocumentNode[] = [];
	for (const n of doc.nodes) {
		const desc = nodeRegistry[n.type];
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (desc === undefined) {
			console.warn(`[graph] unknown node type "${n.type}" — dropping`);
			continue;
		}
		nodes.push({
			...n,
			data: { ...desc.defaultData, ...n.data }
		});
	}
	return { nodes, edges: doc.edges };
}

/**
 * Hydrate a document into the SvelteFlow Node/Edge arrays used by GraphContent.
 * Assigns a new id counter starting after the highest node id.
 */
export function hydrateDocument(doc: GraphDocument): {
	nodes: Node[];
	edges: Edge[];
	nextId: number;
} {
	const normalised = normaliseDocument(doc);

	const nodes: Node[] = normalised.nodes.map((n) => ({
		id: n.id,
		type: n.type,
		data: n.data,
		position: n.position
	}));

	const edges: Edge[] = normalised.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
		sourceHandle: e.sourceHandle ?? undefined,
		targetHandle: e.targetHandle ?? undefined
	}));

	// Find the next id counter
	let maxId = 0;
	for (const n of normalised.nodes) {
		const num = parseInt(n.id.replace(/^node-/, ""), 10);
		if (Number.isFinite(num) && num > maxId) maxId = num;
	}

	return { nodes, edges, nextId: maxId + 1 };
}

/**
 * Serialise current nodes and edges to a GraphDocument (ready to JSON.stringify).
 */
export function serialiseDocument(nodes: Node[], edges: Edge[]): GraphDocument {
	return {
		nodes: nodes.map(({ id, type, data, position }) => ({
			id,
			type: type ?? "",
			data,
			position
		})),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined
		}))
	};
}

// ── Reactive state manager ───────────────────────────────────────────────────

export class GraphManager {
	nodes = $state<Node[]>([]);
	edges = $state<Edge[]>([]);
	nodeIdCounter = $state(1);

	constructor(defaults?: GraphDocument) {
		const doc =
			defaults ?? (isGraphDocument(defaultScene) ? defaultScene : { nodes: [], edges: [] });
		const result = hydrateDocument(doc);
		this.nodes = result.nodes;
		this.edges = result.edges;
		this.nodeIdCounter = result.nextId;
	}

	loadDocument(doc: GraphDocument) {
		const result = hydrateDocument(doc);
		this.nodes = result.nodes;
		this.edges = result.edges;
		this.nodeIdCounter = result.nextId;
	}

	/**
	 * Return the serialised document as a JSON text string.
	 */
	getDocument(): string {
		const doc = serialiseDocument(this.nodes, this.edges);
		return JSON.stringify(doc, null, "\t");
	}

	/**
	 * Load a document from a raw JSON string.
	 */
	loadFromString(text: string) {
		try {
			const doc = JSON.parse(text) as GraphDocument;
			this.loadDocument(doc);
		} catch (err) {
			console.error("[graph] failed to parse JSON", err);
		}
	}

	/**
	 * Trigger a browser download of the graph document.
	 */
	save() {
		const blob = new Blob([this.getDocument()], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "graph.json";
		a.click();
		URL.revokeObjectURL(url);
	}

	async upload(file: File) {
		try {
			const text = await file.text();
			const doc = JSON.parse(text) as GraphDocument;
			this.loadDocument(doc);
		} catch (err) {
			console.error("[graph] failed to parse uploaded JSON", err);
		}
	}
}

// ── Context helpers ──────────────────────────────────────────────────────────

const KEY = Symbol("graph-manager");

export function setGraphManager(m: GraphManager) {
	setContext(KEY, m);
}

export function getGraphManager(): GraphManager {
	return getContext<GraphManager>(KEY);
}
