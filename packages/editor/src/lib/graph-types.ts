import type { Edge } from "@xyflow/svelte";

import type { GroupedNode } from "./types";

// ── Serialisable document types ──────────────────────────────────────────────

/** A single subgraph: what used to be the whole document is now one level of it. */
export type GraphDocument = {
	nodes: GraphDocumentNode[];
	edges: GraphDocumentEdge[];
	/** Shared display label for all instances of this group. */
	label?: string;
	/** Whether instances of this group are locked (non-editable) by default. */
	locked?: boolean;
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
	sourceHandle?: string;
	targetHandle?: string;
};

/** The whole project. Exactly one per file/save. */
export type GraphProject = {
	definitions: Record<string, GraphDocument>;
	root: GraphDocument;
};

export type HydratedGraphDocument = {
	nodes: GroupedNode[];
	edges: Edge[];
	label?: string;
	locked?: boolean;
};

export type HydratedGraphProject = {
	definitions: Record<string, HydratedGraphDocument>;
	root: HydratedGraphDocument;
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
		"root" in obj &&
		"definitions" in obj &&
		isGraphDocument(obj.root)
	);
}
