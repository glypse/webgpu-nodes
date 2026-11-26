import * as v from "valibot";

import { COLOR_SPACES } from "../graph/settings";
import { SOCKET_TYPES } from "../types";

const Finite = v.pipe(v.number(), v.finite());
const Count = v.pipe(v.number(), v.integer(), v.minValue(0));

/**
 * A number as JSON can't always hold one: an f32 result may be NaN, an
 * infinity or a negative zero, and which one is the behaviour being pinned.
 */
export const ExactNumberSchema = v.union([
	v.number(),
	v.picklist(["NaN", "Infinity", "-Infinity", "-0"]),
]);
export type ExactNumber = v.InferOutput<typeof ExactNumberSchema>;

export function exactNumber(x: ExactNumber): number {
	if (typeof x === "number") return x;
	return x === "NaN" ? NaN : x === "Infinity" ? Infinity : x === "-Infinity" ? -Infinity : -0;
}

export function toExactNumber(x: number): ExactNumber {
	if (Number.isNaN(x)) return "NaN";
	if (x === Infinity) return "Infinity";
	if (x === -Infinity) return "-Infinity";
	return Object.is(x, -0) ? "-0" : x;
}

const SizeSchema = v.object({ width: Count, height: Count });

export const FrameInputsSchema = v.object({ time: Finite, delta: Finite, frame: Count });
export type FixtureFrame = v.InferOutput<typeof FrameInputsSchema>;

/** Pixel x, y of rows top first; UV is `((x + 0.5) / width, 1 - (y + 0.5) / height)`. */
const RegionSchema = v.object({ x: Count, y: Count, width: Count, height: Count });

/** Both must be exceeded for a value to be off: `|a - b| > abs && |a - b| > rel * |b|`. */
const ToleranceSchema = v.object({ abs: Finite, rel: v.optional(Finite, 0) });
export type Tolerance = v.InferOutput<typeof ToleranceSchema>;

/** Channels compared, of RGBA: all four when absent. */
const ChannelsSchema = v.optional(v.array(v.pipe(Count, v.maxValue(3))));

/** Which frame of `frames` a check reads: the last when absent. */
const FrameIndexSchema = v.optional(Count);

const PixelsCheckSchema = v.object({
	kind: v.literal("pixels"),
	frame: FrameIndexSchema,
	tolerance: ToleranceSchema,
	/** `null` components are not compared. */
	pixels: v.array(
		v.object({
			x: Count,
			y: Count,
			rgba: v.tuple([
				v.nullable(ExactNumberSchema),
				v.nullable(ExactNumberSchema),
				v.nullable(ExactNumberSchema),
				v.nullable(ExactNumberSchema),
			]),
		}),
	),
});

/** Every pixel of `region` (every `stride`th) against the CPU evaluator of the same project and frame. */
const CpuCheckSchema = v.object({
	kind: v.literal("cpu"),
	frame: FrameIndexSchema,
	region: v.optional(RegionSchema),
	stride: v.optional(v.pipe(Count, v.minValue(1)), 1),
	channels: ChannelsSchema,
	tolerance: ToleranceSchema,
	/** The share of compared values allowed off, for outputs chaotic in their inputs (hashes, noise). */
	maxOff: v.optional(v.pipe(Finite, v.minValue(0), v.maxValue(1)), 0),
});

/** The motion of the pixel at (x, y) in pixels, y down, of a canvas of (width, height). */
export const MotionSchema = v.variant("kind", [
	v.object({ kind: v.literal("translate"), dx: Finite, dy: Finite }),
	/** `(x - width / 2, y - height / 2) * rate` */
	v.object({ kind: v.literal("zoom"), rate: Finite }),
	/** `(-(y - height / 2), x - width / 2) * rate` */
	v.object({ kind: v.literal("rotate"), rate: Finite }),
	/** `inside` within `radius` of the centre, `outside` elsewhere. */
	v.object({
		kind: v.literal("disc"),
		radius: Finite,
		inside: v.tuple([Finite, Finite]),
		outside: v.tuple([Finite, Finite]),
	}),
]);
export type Motion = v.InferOutput<typeof MotionSchema>;

/**
 * The drawn red and green as a flow in UV per frame (y up), against `motion`:
 * the error of a pixel is `hypot(r * width - dx, -g * height - dy)`, over the
 * pixels `margin` clear of every edge. Off means an error over one pixel.
 */
const FlowCheckSchema = v.object({
	kind: v.literal("flow"),
	frame: FrameIndexSchema,
	motion: MotionSchema,
	margin: Count,
	maxMean: Finite,
	maxOff: v.pipe(Finite, v.minValue(0), v.maxValue(1)),
});

export const CheckSchema = v.variant("kind", [PixelsCheckSchema, CpuCheckSchema, FlowCheckSchema]);
export type Check = v.InferOutput<typeof CheckSchema>;

/**
 * `fixtures/gpu/<name>/expect.json`, next to `project.json` (a saved project)
 * and the files its assets name, at their `file` paths.
 */
export const GpuFixtureSchema = v.object({
	description: v.string(),
	size: SizeSchema,
	/** The target drawn to and read back. */
	format: v.optional(v.picklist(["rgba16float", "rgba32float"]), "rgba32float"),
	colorSpace: v.optional(v.picklist(COLOR_SPACES), "srgb"),
	/** Drawn in order with one compiled plan, keeping state from frame to frame. */
	frames: v.optional(v.array(FrameInputsSchema), [{ time: 0, delta: 1 / 60, frame: 0 }]),
	checks: v.array(CheckSchema),
	/** Measured only: drawn and timed, never failing on time. */
	timed: v.optional(v.boolean(), false),
});
export type GpuFixture = v.InferOutput<typeof GpuFixtureSchema>;

/**
 * What an input of the node under test is fed. `constant` is a Declare node
 * of the input's type (the node's own value when absent: `values` of `node`);
 * `uv` sweeps each component from `from` to `to` across the canvas, as
 * `from + (to - from) * t` with t being UV's x, y, 1 - x and 1 - y for the
 * components x, y, z and w. Integer and boolean inputs take the sweep
 * converted with To Int / To Uint / To Bool.
 */
export const FeedSchema = v.variant("kind", [
	v.object({ kind: v.literal("constant"), value: v.array(ExactNumberSchema) }),
	v.object({ kind: v.literal("uv"), from: Finite, to: Finite }),
]);
export type Feed = v.InferOutput<typeof FeedSchema>;

/** The node under test, as a project node's data gives it. */
const NodeSetupSchema = v.object({
	types: v.optional(v.record(v.string(), v.picklist(SOCKET_TYPES))),
	settings: v.optional(v.record(v.string(), v.string())),
	values: v.optional(v.record(v.string(), v.union([Finite, v.boolean()]))),
	/**
	 * Other node data, merged in as it is: a curve's points, an index switch's
	 * `cases`, a color ramp's stops. Checked against the graph schema when built.
	 */
	data: v.optional(v.record(v.string(), v.unknown())),
	colorSpace: v.optional(v.picklist(COLOR_SPACES)),
});

/**
 * An exact behaviour: the node fed constants (several links on one input for
 * one that takes a list), and what `output` must be on both the CPU and the GPU.
 */
const NodeCaseSchema = v.object({
	...NodeSetupSchema.entries,
	note: v.optional(v.string()),
	inputs: v.record(v.string(), v.array(v.array(ExactNumberSchema))),
	output: v.string(),
	expect: v.array(ExactNumberSchema),
	/** Exact when absent. */
	tolerance: v.optional(ToleranceSchema),
});

/**
 * The node fed `inputs` across a canvas, the GPU drawing `output` as the CPU
 * evaluates it. A list of feeds gives an input several links, one per feed, for
 * inputs that take a list of operands.
 */
const NodeSweepSchema = v.object({
	...NodeSetupSchema.entries,
	note: v.optional(v.string()),
	inputs: v.record(v.string(), v.union([FeedSchema, v.array(FeedSchema)])),
	output: v.string(),
	tolerance: ToleranceSchema,
	maxOff: v.optional(v.pipe(Finite, v.minValue(0), v.maxValue(1)), 0),
	/** Compares every `stride`th pixel along each axis, for outputs slow to evaluate on the CPU. */
	stride: v.optional(v.pipe(Count, v.minValue(1)), 1),
});

/**
 * `fixtures/nodes/<node>.json`: the agreement table of a node type, or of a
 * standard-library group by its id, whose inputs and outputs are then named
 * by their labels.
 */
export const NodeTableSchema = v.object({
	node: v.string(),
	/** Why the node isn't tested, if it isn't: no CPU implementation, needs a texture… */
	skip: v.optional(v.string()),
	/** What the table's tolerances rest on, when that applies to every sweep. */
	note: v.optional(v.string()),
	cases: v.optional(v.array(NodeCaseSchema), []),
	sweeps: v.optional(v.array(NodeSweepSchema), []),
});
export type NodeTable = v.InferOutput<typeof NodeTableSchema>;
