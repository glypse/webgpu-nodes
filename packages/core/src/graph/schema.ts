import * as v from "valibot";

import { ASSET_KINDS, AssetSchema, VideoPlaybackSchema } from "../assets/assets";
import { COLOR_MODES } from "../color/modes";
import { CURVE_POINT_KINDS } from "../curve";
import { FRAME_TINTS } from "../frames/analysis";
import { NODE_TYPES } from "../nodes/registry";
import { ScreenSchema, ViewportSchema } from "../screen/schema";
import { COLOR_DISPLAYS, type NodeWidget, SOCKET_TYPES, WGSL_TYPES } from "../types";
import {
	FiniteSchema,
	IdSchema,
	LabelSchema,
	listOf,
	MAX_ASSETS,
	MAX_CASES,
	MAX_CODE_LENGTH,
	MAX_DEFINITIONS,
	MAX_EDGES_PER_DOCUMENT,
	MAX_ITERATIONS,
	MAX_NODES_PER_DOCUMENT,
	MAX_NOTE_LENGTH,
} from "./limits";
import { defaultSettings, ProjectSettingsSchema } from "./settings";

const PositionSchema = v.object({
	x: FiniteSchema,
	y: FiniteSchema,
});

const GroupSchema = v.object({
	definitionRef: IdSchema,
	locked: v.boolean(),
});

const TypeOwnerSchema = v.object({
	variable: IdSchema,
	types: listOf(v.picklist(WGSL_TYPES)),
});

const HandleFields = {
	id: IdSchema,
	label: LabelSchema,
	variants: v.optional(
		listOf(
			v.object({
				value: FiniteSchema,
				label: LabelSchema,
				types: v.optional(listOf(v.picklist(WGSL_TYPES))),
			}),
		),
	),
	compiled: v.optional(v.boolean()),
	owner: v.optional(v.object({ enumId: IdSchema, value: FiniteSchema })),
	typeOwner: v.optional(TypeOwnerSchema),
	variantsBy: v.optional(IdSchema),
	min: v.optional(FiniteSchema),
	max: v.optional(FiniteSchema),
	display: v.optional(v.picklist(COLOR_DISPLAYS)),
};

const HandleSchema = v.object({ ...HandleFields, type: v.picklist(WGSL_TYPES) });

const VariableTypeSchemas = [
	v.strictObject({ variable: IdSchema }),
	v.strictObject({ inferred: v.literal(true) }),
] as const;

const HandleTypeSchema = v.union([v.picklist(SOCKET_TYPES), ...VariableTypeSchemas]);

const ZoneItemSchema = v.object({
	...HandleFields,
	type: v.union([v.picklist(WGSL_TYPES), ...VariableTypeSchemas]),
});

const GroupHandleSchema = v.object({
	...HandleFields,
	viewer: v.optional(v.literal(true)),
	type: HandleTypeSchema,
});

const TypeVariableSchema = v.object({
	id: IdSchema,
	name: LabelSchema,
	types: listOf(v.picklist(WGSL_TYPES)),
});

const Vec2Schema = v.object({ x: FiniteSchema, y: FiniteSchema });

const CurvePointSchema = v.object({
	x: FiniteSchema,
	y: FiniteSchema,
	kind: v.picklist(CURVE_POINT_KINDS),
	left: Vec2Schema,
	right: Vec2Schema,
});

const ScalarValueSchema = v.union([FiniteSchema, v.boolean()]);

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
	label: v.optional(LabelSchema),
	values: v.optional(v.record(IdSchema, InputValueSchema)),
	settings: v.optional(v.record(IdSchema, LabelSchema)),
	types: v.optional(v.record(IdSchema, v.picklist(SOCKET_TYPES))),
	items: v.optional(listOf(ZoneItemSchema)),
	pairedOutput: v.optional(IdSchema),
	maxIterations: v.optional(
		v.pipe(FiniteSchema, v.integer(), v.minValue(0), v.maxValue(MAX_ITERATIONS)),
	),
	cases: v.optional(v.pipe(FiniteSchema, v.integer(), v.minValue(1), v.maxValue(MAX_CASES))),
	curve: v.optional(listOf(CurvePointSchema)),
	code: v.optional(v.pipe(v.string(), v.maxLength(MAX_CODE_LENGTH))),
	sockets: v.optional(
		v.strictObject({ inputs: listOf(HandleSchema), outputs: listOf(HandleSchema) }),
	),
	note: v.optional(v.pipe(v.string(), v.maxLength(MAX_NOTE_LENGTH))),
	tint: v.optional(v.picklist(FRAME_TINTS)),
	hideLinks: v.optional(v.boolean()),
	hideUnlinked: v.optional(v.boolean()),
	asset: v.optional(IdSchema),
	playback: v.optional(VideoPlaybackSchema),
});

const GraphDocumentNodeSchema = v.object({
	id: IdSchema,
	type: v.picklist(NODE_TYPES),
	data: NodeDataSchema,
	position: PositionSchema,
	group: v.optional(GroupSchema),
	frame: v.optional(IdSchema),
});

const GraphDocumentEdgeSchema = v.object({
	id: IdSchema,
	source: IdSchema,
	target: IdSchema,
	sourceHandle: IdSchema,
	targetHandle: IdSchema,
});

export const GraphDocumentSchema = v.object({
	nodes: v.pipe(v.array(GraphDocumentNodeSchema), v.maxLength(MAX_NODES_PER_DOCUMENT)),
	edges: v.pipe(v.array(GraphDocumentEdgeSchema), v.maxLength(MAX_EDGES_PER_DOCUMENT)),
	label: v.optional(LabelSchema),
	locked: v.optional(v.boolean()),
	viewport: v.optional(ViewportSchema),
	typeVariables: v.optional(listOf(TypeVariableSchema)),
	inputs: v.optional(listOf(GroupHandleSchema)),
	outputs: v.optional(listOf(GroupHandleSchema)),
	defaults: v.optional(v.record(IdSchema, InputValueSchema)),
});

export const GraphProjectSchema = v.object({
	definitions: v.pipe(
		v.record(IdSchema, GraphDocumentSchema),
		v.check((definitions) => Object.keys(definitions).length <= MAX_DEFINITIONS),
	),
	settings: v.optional(ProjectSettingsSchema, defaultSettings),
	layout: v.optional(ScreenSchema),
	assets: v.optional(v.pipe(v.array(AssetSchema), v.maxLength(MAX_ASSETS))),
});

/**
 * Groups exported to be imported into other projects (see
 * `GraphModel.exportGroups`): each with the user groups it nests, and the
 * assets they read.
 */
export const GroupsFileSchema = v.object({
	groups: v.pipe(
		v.array(
			v.object({
				id: IdSchema,
				label: LabelSchema,
				category: LabelSchema,
				dependencies: v.pipe(v.array(IdSchema), v.maxLength(MAX_DEFINITIONS)),
				definition: GraphDocumentSchema,
			}),
		),
		v.maxLength(MAX_DEFINITIONS),
	),
	assets: v.pipe(v.array(AssetSchema), v.maxLength(MAX_ASSETS)),
});

export type GroupsFile = v.InferOutput<typeof GroupsFileSchema>;

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
	v.object({ kind: v.literal("code") }),
	v.object({ kind: v.literal("cases") }),
	v.object({ kind: v.literal("asset"), media: v.picklist(ASSET_KINDS) }),
]) satisfies v.GenericSchema<unknown, NodeWidget>;
