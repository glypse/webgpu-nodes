import type { Screen } from "../screen/screen";
import type { NodeData, NodeWidget, TypeVariable } from "../types";
import type { ProjectSettings } from "./settings";

/** A document's camera: pan offset and zoom. */
export type Viewport = { x: number; y: number; zoom: number };

// ── Serialisable document types ──────────────────────────────────────────────

/** Sentinel key for the root document inside `definitions`. */
export const ROOT_ID = "__root__";

/** A single subgraph: what used to be the whole document is now one level of it. */
export type GraphDocument = {
	nodes: GraphDocumentNode[];
	edges: GraphDocumentEdge[];
	/** Shared display label for all instances of this group. */
	label?: string;
	/** Whether instances of this group are locked (non-editable) by default. */
	locked?: boolean;
	/** Per-document camera (pan + zoom), persisted so navigating between
	 *  subgraphs restores the previous view instead of sharing one global viewport. */
	viewport?: Viewport;
	/** Types the group's sockets share, each group node deciding which (see `SocketType`). */
	typeVariables?: TypeVariable[];
};

export type GraphDocumentNode = {
	id: string;
	type: string;
	data: NodeData;
	position: { x: number; y: number };
	/**
	 * Present only on group-type nodes.
	 */
	group?: {
		/**
		 * The subgraph the group is pointing to
		 */
		definitionRef: string;
		/**
		 * Whether the subgraph is editable or not
		 */
		locked: boolean;
	};
};

export type GraphDocumentEdge = {
	id: string;
	source: string;
	target: string;
	sourceHandle: string;
	targetHandle: string;
};

/** The whole project. Exactly one per file/save. Root lives in `definitions[ROOT_ID]`. */
export type GraphProject = {
	definitions: Record<string, GraphDocument>;
	/** Defaults when absent (see `defaultSettings`). */
	settings?: ProjectSettings;
	/** The editor panels it was saved with; the default layout when absent. */
	layout?: Screen;
};

// ── In-memory (hydrated) types ───────────────────────────────────────────────

/**
 * A node of a hydrated document. UI node types may carry extra presentation
 * fields; `width`, `height` and `selected` are read when present.
 */
export type GraphNode = {
	id: string;
	type?: string;
	data: NodeData;
	position: { x: number; y: number };
	/** Present only on group-type nodes. */
	group?: {
		/** The subgraph the group points to. */
		definitionRef: string;
		/** Whether the subgraph is editable or not. */
		locked: boolean;
	};
	deletable?: boolean;
	selected?: boolean;
	width?: number;
	height?: number;
};

/** An edge of a hydrated document: always handle-to-handle. */
export type GraphEdge = GraphDocumentEdge & { selected?: boolean };

/**
 * A subgraph held in memory: nodes, edges, lookup indexes and metadata.
 *
 * The model only ever *reassigns* `nodes` / `edges` (never mutates them in
 * place) and rebuilds the indexes after each reassignment, so a front end can
 * back these fields with its own reactive storage.
 */
export type HydratedGraphDocument = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	nodesById: Map<string, GraphNode>;
	edgesBySource: Map<string, GraphEdge[]>;
	edgesByTarget: Map<string, GraphEdge[]>;
	label: string | undefined;
	locked: boolean;
	viewport: Viewport | undefined;
	typeVariables: TypeVariable[];
	/** A widget a standard-library group's nodes draw (see `StandardLibraryEntry.widget`). */
	widget?: NodeWidget;
};

/** A plain, non-reactive document. */
export function createPlainDocument(): HydratedGraphDocument {
	return {
		nodes: [],
		edges: [],
		nodesById: new Map(),
		edgesBySource: new Map(),
		edgesByTarget: new Map(),
		label: undefined,
		locked: false,
		viewport: undefined,
		typeVariables: [],
	};
}

export type HydratedGraphProject = {
	definitions: Map<string, HydratedGraphDocument>;
};

export type StandardLibraryEntry = {
	id: string;
	/** Changes whenever the definition does (see `libraryVersion`). */
	version: string;
	/** What group nodes reference: the id and version (see `libraryRef`). */
	ref: string;
	label: string;
	aliases: string[];
	category: string;
	dependencies: string[];
	definition: GraphDocument;
	/**
	 * A widget its group nodes draw. Only the standard library has them: the
	 * front end's code behind a widget relies on what the group computes.
	 */
	widget?: NodeWidget;
};

export function isGraphDocument(obj: unknown): obj is GraphDocument {
	return typeof obj === "object" && obj !== null && "nodes" in obj && "edges" in obj;
}

export function isGraphProject(obj: unknown): obj is GraphProject {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"definitions" in obj &&
		obj.definitions instanceof Map &&
		isGraphDocument((obj.definitions as Map<string, unknown>).get(ROOT_ID))
	);
}
