import * as v from "valibot";

import { COLOR_MODES } from "../color/modes";
import { CURVE_POINT_KINDS } from "../curve";
import { COLOR_DISPLAYS, type NodeWidget, WGSL_TYPES } from "../types";

const PositionSchema = v.object({
	x: v.number(),
	y: v.number(),
});

const GroupSchema = v.object({
	definitionRef: v.string(),
	locked: v.boolean(),
});

const HandleFields = {
	id: v.string(),
	label: v.string(),
	variants: v.optional(v.array(v.object({ value: v.number(), label: v.string() }))),
	owner: v.optional(v.object({ enumId: v.string(), value: v.number() })),
	min: v.optional(v.number()),
	max: v.optional(v.number()),
	display: v.optional(v.picklist(COLOR_DISPLAYS)),
};

const HandleSchema = v.object({ ...HandleFields, type: v.picklist(WGSL_TYPES) });

const GroupHandleSchema = v.object({
	...HandleFields,
	type: v.union([
		v.picklist(WGSL_TYPES),
		v.strictObject({ variable: v.string() }),
		v.strictObject({ inferred: v.literal(true) }),
	]),
});

const TypeVariableSchema = v.object({
	id: v.string(),
	name: v.string(),
	types: v.array(v.picklist(WGSL_TYPES)),
});

const Vec2Schema = v.object({ x: v.number(), y: v.number() });

const CurvePointSchema = v.object({
	x: v.number(),
	y: v.number(),
	kind: v.picklist(CURVE_POINT_KINDS),
	left: Vec2Schema,
	right: Vec2Schema,
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
	handles: v.optional(v.array(GroupHandleSchema)),
	items: v.optional(v.array(HandleSchema)),
	pairedOutput: v.optional(v.string()),
	maxIterations: v.optional(v.number()),
	curve: v.optional(v.array(CurvePointSchema)),
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
	typeVariables: v.optional(v.array(TypeVariableSchema)),
});

export const GraphProjectSchema = v.object({
	definitions: v.record(v.string(), GraphDocumentSchema),
});

/** A group exported on its own (see `GraphModel.exportGroupFiles`). */
const GroupFileSchema = v.object({
	id: v.string(),
	label: v.string(),
	category: v.string(),
	dependencies: v.array(v.string()),
	definition: GraphDocumentSchema,
});

export const GroupFilesSchema = v.array(GroupFileSchema);

/** Every kind of `NodeWidget`, by its `kind`. */
export const NodeWidgetSchema = v.variant("kind", [
	v.object({
		kind: v.literal("color"),
		mode: v.string(),
		modes: v.record(
			v.string(),
			v.object({
				space: v.picklist(COLOR_MODES),
				components: v.tuple([v.string(), v.string(), v.string()]),
			}),
		),
	}),
	v.object({ kind: v.literal("curve") }),
]) satisfies v.GenericSchema<unknown, NodeWidget>;
