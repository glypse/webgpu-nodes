import * as v from "valibot";

import { ASSET_KINDS, AssetSchema, VideoPlaybackSchema } from "../assets/assets";
import { COLOR_MODES } from "../color/modes";
import { CURVE_POINT_KINDS } from "../curve";
import { FRAME_TINTS } from "../frames/analysis";
import { isSocketName } from "../nodes/custom";
import { NODE_TYPES } from "../nodes/registry";
import { TEXTURE_FORMATS } from "../passes/textures";
import { isRampStopId } from "../ramp/ramp";
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

const HandleTypeSchema = v.union([
	v.picklist(SOCKET_TYPES),
	v.strictObject({ variable: IdSchema }),
]);

const ZoneItemSchema = v.object({
	...HandleFields,
	type: v.optional(HandleTypeSchema),
	format: v.optional(v.picklist(TEXTURE_FORMATS)),
	size: v.optional(v.picklist(["scale", "pixels"])),
});

const GroupHandleSchema = v.object({
	...HandleFields,
	viewer: v.optional(v.literal(true)),
	type: v.optional(HandleTypeSchema),
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

const RampStopSchema = v.object({
	id: v.pipe(IdSchema, v.check(isRampStopId)),
	position: FiniteSchema,
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

/** A Custom WGSL node's sockets, whose labels are written into its shader as they are. */
const CustomSocketsSchema = v.pipe(
	v.strictObject({ inputs: listOf(HandleSchema), outputs: listOf(HandleSchema) }),
	v.check(({ inputs, outputs }) => {
		const labels = [...inputs, ...outputs].map((s) => s.label);
		return labels.every(isSocketName) && new Set(labels).size === labels.length;
	}, "Every socket needs a WGSL name of its own."),
);

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
	ramp: v.optional(
		v.pipe(
			listOf(RampStopSchema),
			v.check(
				(stops) => new Set(stops.map((s) => s.id)).size === stops.length,
				"Every ramp stop needs an id of its own.",
			),
		),
	),
	code: v.optional(v.pipe(v.string(), v.maxLength(MAX_CODE_LENGTH))),
	sockets: v.optional(CustomSocketsSchema),
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
	v.object({ kind: v.literal("ramp") }),
	v.object({ kind: v.literal("code") }),
	v.object({ kind: v.literal("cases") }),
	v.object({ kind: v.literal("asset"), media: v.picklist(ASSET_KINDS) }),
	v.object({ kind: v.literal("items") }),
]) satisfies v.GenericSchema<unknown, NodeWidget>;
