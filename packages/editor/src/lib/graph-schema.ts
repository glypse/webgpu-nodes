import * as v from "valibot";

import { WGSL_TYPES } from "./types";

const PositionSchema = v.object({
	x: v.number(),
	y: v.number(),
});

const GroupSchema = v.object({
	definitionRef: v.string(),
	locked: v.boolean(),
});

const HandleSchema = v.object({
	id: v.string(),
	label: v.string(),
	type: v.picklist(WGSL_TYPES),
});

// Group boundary nodes carry a typed `handles` array; every other node can hold
// arbitrary serialised data, so we accept a generic record as a fallback.
const BoundaryNodeDataSchema = v.object({ handles: v.array(HandleSchema) });
const GenericNodeDataSchema = v.record(v.string(), v.unknown());

const GraphDocumentNodeSchema = v.object({
	id: v.string(),
	type: v.string(),
	data: v.union([BoundaryNodeDataSchema, GenericNodeDataSchema]),
	position: PositionSchema,
	group: v.optional(GroupSchema),
});

const GraphDocumentEdgeSchema = v.object({
	id: v.string(),
	source: v.string(),
	target: v.string(),
	sourceHandle: v.optional(v.string()),
	targetHandle: v.optional(v.string()),
});

const ViewportSchema = v.object({
	x: v.number(),
	y: v.number(),
	zoom: v.number(),
});

const GraphDocumentSchema = v.object({
	nodes: v.array(GraphDocumentNodeSchema),
	edges: v.array(GraphDocumentEdgeSchema),
	label: v.optional(v.string()),
	locked: v.optional(v.boolean()),
	viewport: v.optional(ViewportSchema),
});

export const GraphProjectSchema = v.object({
	root: GraphDocumentSchema,
	definitions: v.record(v.string(), GraphDocumentSchema),
});

const StandardLibraryEntrySchema = v.object({
	id: v.string(),
	label: v.string(),
	category: v.string(),
	dependencies: v.array(v.string()),
	definition: GraphDocumentSchema,
});

export const StandardLibraryEntriesSchema = v.array(StandardLibraryEntrySchema);

export type ParsedGraphProject = v.InferOutput<typeof GraphProjectSchema>;
export type ParsedStandardLibraryEntry = v.InferOutput<typeof StandardLibraryEntrySchema>;
