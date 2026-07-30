import type { Edge, Viewport } from "@xyflow/svelte";

import type { GroupedNode } from "./types";

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
};

export type GraphDocumentNode = {
	id: string;
	type: string;
	data: Record<string, unknown>;
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
};

/**
 * SvelteFlow's `Edge` type has `sourceHandle` / `targetHandle` as optional.
 * Our domain model requires them, so we narrow the type for edges that live
 * inside a hydrated document.
 */
export type HydratedEdge = Edge & {
	sourceHandle: string;
	targetHandle: string;
};

export type HydratedGraphDocument = {
	nodes: GroupedNode[];
	edges: HydratedEdge[];
	label?: string;
	locked?: boolean;
	/** Per-document camera (pan + zoom). Undefined until the user has interacted
	 *  or a saved viewport has been loaded. */
	viewport?: Viewport;
};

export type HydratedGraphProject = {
	definitions: Record<string, HydratedGraphDocument>;
};

export type StandardLibraryEntry = {
	id: string;
	label: string;
	category: string;
	dependencies: string[];
	definition: GraphDocument;
};

export function isGraphDocument(obj: unknown): obj is GraphDocument {
	return typeof obj === "object" && obj !== null && "nodes" in obj && "edges" in obj;
}

export function isGraphProject(obj: unknown): obj is GraphProject {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"definitions" in obj &&
		typeof obj.definitions === "object" &&
		obj.definitions !== null &&
		isGraphDocument((obj.definitions as Record<string, unknown>)[ROOT_ID])
	);
}
