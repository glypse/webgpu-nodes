import * as v from "valibot";

import { WGSL_TYPES } from "../types";

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
	options: v.optional(v.array(v.string())),
});

const ScalarValueSchema = v.union([v.number(), v.boolean()]);

const InputValueSchema = v.union([
	ScalarValueSchema,
	v.strictObject({
		x: v.optional(ScalarValueSchema),
		y: v.optional(ScalarValueSchema),
		z: v.optional(ScalarValueSchema),
		w: v.optional(ScalarValueSchema),
	}),
]);

const NodeDataSchema = v.strictObject({
	values: v.optional(v.record(v.string(), InputValueSchema)),
	settings: v.optional(v.record(v.string(), v.string())),
	types: v.optional(v.record(v.string(), v.picklist(WGSL_TYPES))),
	handles: v.optional(v.array(HandleSchema)),
	items: v.optional(v.array(HandleSchema)),
	pairedOutput: v.optional(v.string()),
	maxIterations: v.optional(v.number()),
});

const GraphDocumentNodeSchema = v.object({
	id: v.string(),
	type: v.string(),
	data: NodeDataSchema,
	position: PositionSchema,
	group: v.optional(GroupSchema),
});

const GraphDocumentEdgeSchema = v.object({
	id: v.string(),
	source: v.string(),
	target: v.string(),
	sourceHandle: v.string(),
	targetHandle: v.string(),
});

const ViewportSchema = v.object({
	x: v.number(),
	y: v.number(),
	zoom: v.number(),
});

export const GraphDocumentSchema = v.object({
	nodes: v.array(GraphDocumentNodeSchema),
	edges: v.array(GraphDocumentEdgeSchema),
	label: v.optional(v.string()),
	locked: v.optional(v.boolean()),
	viewport: v.optional(ViewportSchema),
});

export const GraphProjectSchema = v.object({
	definitions: v.record(v.string(), GraphDocumentSchema),
});

export const StandardLibraryEntrySchema = v.object({
	id: v.string(),
	label: v.string(),
	category: v.string(),
	dependencies: v.array(v.string()),
	definition: GraphDocumentSchema,
});

export const StandardLibraryEntriesSchema = v.array(StandardLibraryEntrySchema);

export type ParsedGraphProject = v.InferOutput<typeof GraphProjectSchema>;
export type ParsedStandardLibraryEntry = v.InferOutput<typeof StandardLibraryEntrySchema>;
