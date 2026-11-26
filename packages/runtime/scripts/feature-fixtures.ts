// Writes the render-plan feature fixtures under fixtures/gpu, one folder per feature.
// Run from packages/runtime: bun --conditions=development scripts/feature-fixtures.ts

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	type GraphModel,
	type NodeType,
	type SocketType,
	TEXTURE_FORMATS,
	type TextureFormat,
} from "$core";
import type { GpuFixture } from "$core/testing";

import { parseGpuFixture } from "../src/gpu-tests/fixtures";
import { graph, socket, type TestLink, type TestNode } from "../src/gpu-tests/harness";

const FIXTURES = join(import.meta.dir, "../../../fixtures/gpu");

/** The target every fixture reads back: nothing is rounded but what the features round. */
const FORMAT = "rgba32float";
const TOLERANCE = { abs: 1e-5, rel: 0 };

type ExpectFile = Partial<GpuFixture> & Pick<GpuFixture, "description" | "size" | "checks">;
type Check = GpuFixture["checks"][number];
type Pixel = Extract<Check, { kind: "pixels" }>["pixels"][number];
type Frame = { time: number; delta: number; frame: number };
type Fixture = { name: string; model: GraphModel; expect: ExpectFile };

type Value = { x?: number; y?: number; z?: number; w?: number };

// Builders

const node = (id: string, type: NodeType, data: TestNode["data"] = {}): TestNode => ({
	id,
	type,
	data,
});

/** A Declare of `type`, its components the values of inputs x, y, z and w. */
function declare(id: string, type: SocketType, values: Value = {}): TestNode {
	return node(id, "declare", { types: { declare: type }, values });
}

/** A render texture of one item, of `format`, its size given by `settings` and `values`. */
function render(
	id: string,
	format: TextureFormat | "rgba32float",
	settings: Record<string, string> = {},
	values: Record<string, number | Value> = {},
): TestNode {
	return node(id, "render-texture", {
		items: [{ id: "item", label: "Item", type: "vec4f", format }],
		settings,
		values,
	});
}

/** A render texture of `pixels` square-or-not pixels. */
function pixelRender(
	id: string,
	width: number,
	height: number,
	format: TextureFormat = FORMAT,
): TestNode {
	return render(id, format, { mode: "pixels" }, { pixels: { x: width, y: height } });
}

function sample(id: string, interpolation = 0, extension = 0, level = 0): TestNode {
	return node(id, "sample-texture", { values: { interpolation, extension, level } });
}

function sampleOf(id: string, interpolation: 0 | 1, extension: 0 | 1 | 2 | 3, level = 0): TestNode {
	return sample(id, interpolation, extension, level);
}

const LINEAR = 0;
const CLOSEST = 1;
const CLAMP = 0;
const REPEAT = 1;
const MIRROR = 2;
const TRANSPARENT = 3;

function px(
	x: number,
	y: number,
	r: number | null,
	g: number | null = null,
	b: number | null = null,
	a: number | null = null,
): Pixel {
	return { x, y, rgba: [r, g, b, a] };
}

function pixelsCheck(pixels: Pixel[], frame?: number, tolerance = TOLERANCE): Check {
	return frame === undefined
		? { kind: "pixels", tolerance, pixels }
		: { kind: "pixels", frame, tolerance, pixels };
}

function cpuCheck(
	region?: { x: number; y: number; width: number; height: number },
	stride = 1,
): Check {
	return {
		kind: "cpu",
		...(region === undefined ? {} : { region }),
		stride,
		tolerance: TOLERANCE,
		maxOff: 0,
	};
}

/** The UV of a pixel's centre, y up. */
const uvAt = (x: number, y: number, width: number, height: number): [number, number] => [
	(x + 0.5) / width,
	1 - (y + 0.5) / height,
];

const CORNERS = (width: number, height: number): [number, number][] => {
	const points = [
		[0, 0],
		[width - 1, 0],
		[0, height - 1],
		[width - 1, height - 1],
	] as [number, number][];
	return points.filter(([x, y], i) => points.findIndex(([a, b]) => a === x && b === y) === i);
};

// Frames

/** Frames whose time is `i / 60`, with a delta of 1 / 60 and a frame index of `i`. */
function frameRun(count: number): Frame[] {
	return Array.from({ length: count }, (_, i) => ({ time: i / 60, delta: 1 / 60, frame: i }));
}

/** Frames at the given times, each frame's index being its position unless given. */
function timed(times: [number, number][]): Frame[] {
	return times.map(([frame, time]) => ({ time, delta: 1 / 60, frame }));
}

// Frame inputs and resolution

function frameInputsFixture(): Fixture {
	const frames: Frame[] = [
		{ time: 0, delta: 1 / 60, frame: 0 },
		{ time: 0.5, delta: 1 / 30, frame: 1 },
		{ time: 1.25, delta: 0.1, frame: 7 },
		{ time: 3.75, delta: 0.0625, frame: 300 },
		{ time: 10, delta: 0.25, frame: 1000 },
	];
	return {
		name: "feature-frame-inputs",
		model: graph(
			[
				node("time", "time"),
				node("delta", "delta"),
				node("count", "to-float"),
				declare("c", "vec4f", { w: 1 }),
			],
			[
				["time", "seconds", "c", "x"],
				["delta", "delta", "c", "y"],
				["time", "frame", "count", "e"],
				["count", "result", "c", "z"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description:
				"Time, Delta and Frame at five frames, given in order: the frame inputs are the ones each frame was drawn with, the frame index read back as a float.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			frames: frames.map(({ time, delta, frame }) => ({ time, delta, frame })),
			checks: frames.map((f, i) => pixelsCheck([px(0, 0, f.time, f.delta, f.frame, 1)], i)),
		},
	};
}

function resolutionFixture(width: number, height: number): Fixture {
	const name = `feature-resolution-${String(width)}x${String(height)}`;
	return {
		name,
		model: graph(
			[
				node("res", "resolution"),
				node("uv", "uv"),
				node("size", "separate-vector"),
				node("coords", "separate-vector"),
				declare("c", "vec4f"),
			],
			[
				["res", "resolution", "size", "v"],
				["uv", "uv", "coords", "v"],
				["size", "x", "c", "x"],
				["size", "y", "c", "y"],
				["coords", "x", "c", "z"],
				["coords", "y", "c", "w"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description: `The Resolution of a ${String(width)} by ${String(height)} canvas and the UV at the corners' pixel centres, read back with what the canvas holds.`,
			size: { width, height },
			format: FORMAT,
			checks: [
				pixelsCheck(
					CORNERS(width, height).map(([x, y]) => {
						const [u, v] = uvAt(x, y, width, height);
						return px(x, y, width, height, u, v);
					}),
				),
			],
		},
	};
}

// Render textures

/** Values written as each format keeps them: integers for integer formats, which the format rounds. */
function formatFixture(format: TextureFormat): Fixture {
	const integer = format.endsWith("int") || format.endsWith("uint");
	const [v0, v1, v2, v3] = integer ? [3, 2, 1, 4] : [0.25, 0.5, 0.75, 1];
	const channels = format.startsWith("rgba") ? 4 : format.startsWith("rg") ? 2 : 1;
	const expected: [number, number, number, number] = [
		v0,
		channels >= 2 ? v1 : 0,
		channels === 4 ? v2 : 0,
		channels === 4 ? v3 : 1,
	];
	const tolerance = format === "rgba8unorm" ? { abs: 1 / 255, rel: 0 } : TOLERANCE;
	return {
		name: `feature-format-${format}`,
		model: graph(
			[
				declare("c", "vec4f", { x: v0, y: v1, z: v2, w: v3 }),
				render("drawn", format),
				node("read", "load-texel"),
			],
			[
				["c", "value", "drawn", "item"],
				["drawn", "item", "read", "texture"],
				["read", "value", "out", "color"],
			],
		),
		expect: {
			description: `A render texture of ${format}, drawn with a constant and read back by Load Texel: each texel keeps what the format rounds it to, and the read gives the missing components their defaults.`,
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [
				pixelsCheck(
					CORNERS(4, 4).map(([x, y]) =>
						px(x, y, expected[0], expected[1], expected[2], expected[3]),
					),
					undefined,
					tolerance,
				),
			],
		},
	};
}

function sizeScaleFixture(): Fixture {
	return {
		name: "feature-size-scale",
		model: graph(
			[
				declare("c", "vec4f", { x: 1, w: 1 }),
				render("half", FORMAT, {}, { scale: 0.5 }),
				node("size", "texture-size"),
			],
			[
				["c", "value", "half", "item"],
				["half", "item", "size", "texture"],
				["size", "size", "out", "color"],
			],
		),
		expect: {
			description:
				"A render texture scaled by 0.5 of a 64 px canvas is 32 by 32: Texture Size reads it back.",
			size: { width: 64, height: 64 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, 32, 32, 0, 1)])],
		},
	};
}

function sizePixelsFixture(): Fixture {
	return {
		name: "feature-size-pixels",
		model: graph(
			[
				declare("c", "vec4f", { w: 1 }),
				pixelRender("drawn", 13, 5),
				node("size", "texture-size"),
			],
			[
				["c", "value", "drawn", "item"],
				["drawn", "item", "size", "texture"],
				["size", "size", "out", "color"],
			],
		),
		expect: {
			description:
				"A render texture sized in pixels is that size whatever the canvas is: 13 by 5 on a 16 px canvas.",
			size: { width: 16, height: 16 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, 13, 5, 0, 1)])],
		},
	};
}

function sizeLikeFixture(): Fixture {
	return {
		name: "feature-size-like",
		model: graph(
			[
				declare("c", "vec4f", { w: 1 }),
				pixelRender("base", 24, 10),
				render("half", FORMAT, { mode: "scale" }, { scale: 0.5 }),
				node("size", "texture-size"),
			],
			[
				["c", "value", "base", "item"],
				["base", "item", "half", "like"],
				["c", "value", "half", "item"],
				["half", "item", "size", "texture"],
				["size", "size", "out", "color"],
			],
		),
		expect: {
			description:
				"A render texture scaled by 0.5 of another texture takes that texture's size: 24 by 10 halves to 12 by 5.",
			size: { width: 16, height: 16 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, 12, 5, 0, 1)])],
		},
	};
}

/** Three textures, each read by the next: the centre of the canvas is the UV through all of them. */
function chainFixture(): Fixture {
	return {
		name: "feature-chain-of-three",
		model: graph(
			[
				node("uv", "uv"),
				pixelRender("first", 8, 8),
				sample("read1"),
				render("second", FORMAT, { mode: "pixels" }, { pixels: { x: 16, y: 16 } }),
				sample("read2"),
				render("third", FORMAT, { mode: "scale" }, { scale: 0.5 }),
				sample("read3"),
			],
			[
				["uv", "uv", "first", "item"],
				["uv", "uv", "read1", "uv"],
				["first", "item", "read1", "texture"],
				["read1", "color", "second", "item"],
				["uv", "uv", "read2", "uv"],
				["second", "item", "read2", "texture"],
				["read2", "color", "third", "item"],
				["second", "item", "third", "like"],
				["uv", "uv", "read3", "uv"],
				["third", "item", "read3", "texture"],
				["read3", "color", "out", "color"],
			],
		),
		expect: {
			description:
				"Three render textures, each sampling the one before at the UV: 8, then 16, then 8 px. Away from the edges the linear sample keeps the UV, so the canvas' centre pixel reads the UV there.",
			size: { width: 16, height: 16 },
			format: FORMAT,
			checks: [
				pixelsCheck([px(8, 8, 8.5 / 16, 1 - 8.5 / 16)]),
				cpuCheck({ x: 4, y: 4, width: 8, height: 8 }),
			],
		},
	};
}

// Sampling

/** Red at a UV of a 4-texel row of texel centres (u), under `interpolation`, with clamped coordinates. */
function sampleRed(u: number, interpolation: 0 | 1): number {
	const s = u * 4 - 0.5;
	if (interpolation === LINEAR) return (Math.min(Math.max(s, 0), 3) + 0.5) / 4;
	const index = Math.min(Math.max(Math.round(s), 0), 3);
	return (index + 0.5) / 4;
}

/**
 * Red a sampler gives a UV of an 8 by 2 canvas, the UV sweeping across a
 * 4-texel texture: `null` where the value depends on the edge behaviour the
 * fixture doesn't pin by hand (the CPU check covers those).
 */
function expectedSample(u: number, interpolation: 0 | 1, extension: 0 | 1 | 2 | 3): number | null {
	const inBand = (t: number) => t >= 0.125 && t <= 0.875;
	switch (extension) {
		case CLAMP:
			return sampleRed(u, interpolation);
		case TRANSPARENT:
			return u < 0 || u > 1 ? 0 : sampleRed(u, interpolation);
		case REPEAT: {
			const wrapped = u - Math.floor(u);
			return inBand(wrapped) ? sampleRed(wrapped, interpolation) : null;
		}
		case MIRROR: {
			const mirrored = 1 - Math.abs((u * 0.5 - Math.floor(u * 0.5)) * 2 - 1);
			return inBand(mirrored) ? sampleRed(mirrored, interpolation) : null;
		}
	}
}

const INTERPOLATION_NAMES = { [LINEAR]: "linear", [CLOSEST]: "closest" } as const;
const EXTENSION_NAMES = {
	[CLAMP]: "clamp",
	[REPEAT]: "repeat",
	[MIRROR]: "mirror",
	[TRANSPARENT]: "transparent",
} as const;

/**
 * A 4 by 4 texture of its UV, sampled across an 8 by 2 canvas at 1.6 times
 * the UV minus 0.3, so the sample's coordinates run outside [0, 1] at both ends.
 */
function sampleFixture(interpolation: 0 | 1, extension: 0 | 1 | 2 | 3): Fixture {
	const name = `feature-sample-${INTERPOLATION_NAMES[interpolation]}-${EXTENSION_NAMES[extension]}`;
	const checks: Pixel[] = [];
	for (let x = 0; x < 8; x++) {
		const u = (x + 0.5) / 8;
		const sampled = 1.6 * u - 0.22;
		const want = expectedSample(sampled, interpolation, extension);
		if (want === null) continue;
		const cleared = extension === TRANSPARENT && (sampled < 0 || sampled > 1);
		const rest = cleared ? 0 : null;
		checks.push(px(x, 0, want, rest, rest, rest));
	}
	return {
		name,
		model: graph(
			[
				node("uv", "uv"),
				pixelRender("source", 4, 4),
				declare("scale", "vec2f", { x: 1.6, y: 1.6 }),
				declare("shift", "vec2f", { x: -0.22, y: -0.22 }),
				node("stretch", "mul"),
				node("moved", "add"),
				sampleOf("read", interpolation, extension),
			],
			[
				["uv", "uv", "source", "item"],
				["uv", "uv", "stretch", "operands"],
				["scale", "value", "stretch", "operands"],
				["stretch", "result", "moved", "operands"],
				["shift", "value", "moved", "operands"],
				["moved", "result", "read", "uv"],
				["source", "item", "read", "texture"],
				["read", "color", "out", "color"],
			],
		),
		expect: {
			description: `Sampling a 4 by 4 texture with ${INTERPOLATION_NAMES[interpolation]} interpolation and ${EXTENSION_NAMES[extension]} extension, at UVs from -0.12 to 1.28: inside [0, 1] the texel centres give the UV's red, and outside the extension decides.`,
			size: { width: 8, height: 2 },
			format: FORMAT,
			checks: [pixelsCheck(checks), cpuCheck()],
		},
	};
}

function loadTexelFixture(
	name: string,
	texel: [number, number],
	level: number,
	description: string,
): Fixture {
	const [tx, ty] = texel;
	return {
		name,
		model: graph(
			[
				node("uv", "uv"),
				pixelRender("source", 4, 4),
				declare("place", "vec2i", { x: tx, y: ty }),
				node("read", "load-texel", { values: { texel: { x: tx, y: ty }, level } }),
			],
			[
				["uv", "uv", "source", "item"],
				["source", "item", "read", "texture"],
				["place", "value", "read", "texel"],
				["read", "value", "out", "color"],
			],
		),
		expect: {
			description,
			size: { width: 2, height: 2 },
			format: FORMAT,
			checks: [
				pixelsCheck([px(0, 0, ...loadedTexel(texel)), px(1, 1, ...loadedTexel(texel))]),
			],
		},
	};
}

/** The texel a Load Texel of a 4 by 4 UV texture gives at `texel`, clamped into it. */
function loadedTexel([x, y]: [number, number]): [number, number] {
	const cx = Math.min(Math.max(x, 0), 3);
	const cy = Math.min(Math.max(y, 0), 3);
	return [(cx + 0.5) / 4, 1 - (cy + 0.5) / 4];
}

// Mips and sizes

function mipFixture(name: string, level: number): Fixture {
	return {
		name,
		model: graph(
			[
				node("uv", "uv"),
				render(
					"source",
					FORMAT,
					{ mode: "pixels", mips: "on" },
					{ pixels: { x: 100, y: 60 } },
				),
				sampleOf("read", LINEAR, CLAMP, level),
			],
			[
				["uv", "uv", "source", "item"],
				["uv", "uv", "read", "uv"],
				["source", "item", "read", "texture"],
				["read", "color", "out", "color"],
			],
		),
		expect: {
			description: `A 100 by 60 texture with mips, sampled at level ${String(level)} with the canvas' UV: the UV survives the averaging within about 1.5 px.`,
			size: { width: 100, height: 60 },
			format: FORMAT,
			checks: [
				pixelsCheck([px(50, 30, 50.5 / 100, 1 - 30.5 / 60)], undefined, {
					abs: 0.03,
					rel: 0,
				}),
				cpuCheck(undefined, 7),
			],
		},
	};
}

function textureSizeLevelFixture(
	name: string,
	level: number,
	width: number,
	height: number,
	description: string,
): Fixture {
	const levels = Math.floor(Math.log2(100)) + 1;
	return {
		name,
		model: graph(
			[
				render(
					"source",
					FORMAT,
					{ mode: "pixels", mips: "on" },
					{ pixels: { x: 100, y: 60 } },
				),
				node("size", "texture-size", { values: { level } }),
				node("sizes", "separate-vector"),
				node("levelCount", "to-float"),
				declare("c", "vec4f", { w: 1 }),
			],
			[
				["source", "item", "size", "texture"],
				["size", "size", "sizes", "v"],
				["sizes", "x", "c", "x"],
				["sizes", "y", "c", "y"],
				["size", "levels", "levelCount", "e"],
				["levelCount", "result", "c", "z"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description,
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, width, height, levels, 1)])],
		},
	};
}

// Repeat zones

/** A repeat zone of one f32 item, starting at `start` and adding `step` each iteration. */
function repeatAccumulate(iterations: number | "frame", start: number, step: number): GraphModel {
	const nodes: TestNode[] = [
		node("loop", "repeat-input", {
			pairedOutput: "end",
			values: iterations === "frame" ? { acc: start } : { iterations, acc: start },
		}),
		node("end", "repeat-output", { items: [{ id: "acc", label: "Acc", type: "f32" }] }),
		declare("one", "f32", { x: step }),
		node("next", "add"),
	];
	const links: TestLink[] = [
		["loop", "acc", "next", "operands"],
		["one", "value", "next", "operands"],
		["next", "result", "end", "acc"],
		["end", "acc", "out", "color"],
	];
	if (iterations === "frame") {
		nodes.push(node("frameCount", "time"), node("count", "to-int"));
		links.push(
			["frameCount", "frame", "count", "e"],
			["count", "result", "loop", "iterations"],
		);
	}
	return graph(nodes, links);
}

function repeatFixture(
	name: string,
	iterations: number,
	start: number,
	step: number,
	description: string,
	expected: number,
): Fixture {
	return {
		name,
		model: repeatAccumulate(iterations, start, step),
		expect: {
			description,
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, expected)])],
		},
	};
}

function repeatNestedFixture(): Fixture {
	return {
		name: "feature-repeat-nested",
		model: graph(
			[
				node("outer", "repeat-input", {
					pairedOutput: "outerEnd",
					values: { iterations: 3, acc: 0 },
				}),
				node("outerEnd", "repeat-output", {
					items: [{ id: "acc", label: "Acc", type: "f32" }],
				}),
				node("inner", "repeat-input", {
					pairedOutput: "innerEnd",
					values: { iterations: 4 },
				}),
				node("innerEnd", "repeat-output", {
					items: [{ id: "acc", label: "Acc", type: "f32" }],
				}),
				declare("one", "f32", { x: 1 }),
				node("next", "add"),
			],
			[
				["outer", "acc", "inner", "acc"],
				["inner", "acc", "next", "operands"],
				["one", "value", "next", "operands"],
				["next", "result", "innerEnd", "acc"],
				["innerEnd", "acc", "outerEnd", "acc"],
				["outerEnd", "acc", "out", "color"],
			],
		),
		expect: {
			description:
				"A repeat zone inside another: 3 outer iterations of 4 inner ones, each adding 1, come to 12.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, 12)])],
		},
	};
}

function repeatFrameCountFixture(): Fixture {
	const frames = frameRun(5);
	return {
		name: "feature-repeat-iterations-from-frame",
		model: repeatAccumulate("frame", 0, 1),
		expect: {
			description:
				"A repeat zone whose iteration count is the frame index: each frame adds one per frame it has passed, so the frame's index is the item.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			frames,
			checks: frames.map((_, i) => pixelsCheck([px(0, 0, i)], i)),
		},
	};
}

function repeatStateTypesFixture(): Fixture {
	return {
		name: "feature-repeat-state-types",
		model: graph(
			[
				node("loop", "repeat-input", {
					pairedOutput: "end",
					values: { iterations: 3, acc: 0.5, count: 1 },
				}),
				node("end", "repeat-output", {
					items: [
						{ id: "acc", label: "Acc", type: "f32" },
						{ id: "velocity", label: "Velocity", type: "vec3f" },
						{ id: "count", label: "Count", type: "i32" },
					],
				}),
				declare("zero", "vec3f"),
				declare("stepF", "f32", { x: 1 }),
				declare("stepV", "vec3f", { x: 1, y: 2, z: 3 }),
				declare("stepI", "i32", { x: 2 }),
				node("nextAcc", "add"),
				node("nextVelocity", "add"),
				node("nextCount", "add"),
				node("velocityY", "separate-vector"),
				node("countFloat", "to-float"),
				declare("c", "vec4f", { w: 1 }),
			],
			[
				["loop", "acc", "nextAcc", "operands"],
				["stepF", "value", "nextAcc", "operands"],
				["nextAcc", "result", "end", "acc"],
				["loop", "velocity", "nextVelocity", "operands"],
				["stepV", "value", "nextVelocity", "operands"],
				["nextVelocity", "result", "end", "velocity"],
				["loop", "count", "nextCount", "operands"],
				["stepI", "value", "nextCount", "operands"],
				["nextCount", "result", "end", "count"],
				["zero", "value", "loop", "velocity"],
				["end", "acc", "c", "x"],
				["end", "velocity", "velocityY", "v"],
				["velocityY", "y", "c", "y"],
				["end", "count", "countFloat", "e"],
				["countFloat", "result", "c", "z"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description:
				"A repeat zone of an f32, a vec3f and an i32 item over 3 iterations: 0.5 + 3, the vec3f's y of 0 + 3 * 2 and 1 + 3 * 2.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, 3.5, 6, 7, 1)])],
		},
	};
}

// Pass loops

/**
 * A passes zone of a texture item, offset each iteration by `shift` in UV
 * (read from the previous iteration's texture), drawn on a `size` canvas.
 */
function offsetLoopGraph(iterations: number, shift: number): GraphModel {
	return graph(
		[
			node("uv", "uv"),
			render("source", FORMAT),
			node("loop", "pass-repeat-input", {
				pairedOutput: "end",
				values: { iterations },
			}),
			node("end", "pass-repeat-output", {
				items: [
					{ id: "tex", label: "Tex", type: "texture", size: "scale", format: FORMAT },
				],
				values: { "scale:tex": 1 },
			}),
			declare("offset", "vec2f", { x: shift, y: 0 }),
			node("moved", "add"),
			sampleOf("before", LINEAR, CLAMP),
			render("next", FORMAT),
			sampleOf("final", LINEAR, CLAMP),
		],
		[
			["uv", "uv", "source", "item"],
			["source", "item", "loop", "tex"],
			["uv", "uv", "moved", "operands"],
			["offset", "value", "moved", "operands"],
			["moved", "result", "before", "uv"],
			["loop", "tex", "before", "texture"],
			["before", "color", "next", "item"],
			["next", "item", "end", "tex"],
			["end", "tex", "final", "texture"],
			["uv", "uv", "final", "uv"],
			["final", "color", "out", "color"],
		],
	);
}

function offsetLoopFixture(name: string, iterations: number, size: number): Fixture {
	const shift = 1 / 8;
	const shifts = iterations * shift * size;
	const red = (x: number) => (Math.min(x + shifts, size - 1) + 0.5) / size;
	const green = (y: number) => 1 - (y + 0.5) / size;
	return {
		name,
		model: offsetLoopGraph(iterations, shift),
		expect: {
			description: `A passes zone of a ${String(size)} px texture read at the previous iteration's texel shifted by 1/8 of the texture, ${String(iterations)} times: each texel takes the one ${String(iterations)} to its right, clamped at the edge.`,
			size: { width: size, height: size },
			format: FORMAT,
			checks: [pixelsCheck(CORNERS(size, size).map(([x, y]) => px(x, y, red(x), green(y))))],
		},
	};
}

function passesManyItemsFixture(): Fixture {
	return {
		name: "feature-passes-several-items",
		model: graph(
			[
				node("uv", "uv"),
				render("source", FORMAT),
				declare("zero", "f32"),
				node("loop", "pass-repeat-input", {
					pairedOutput: "end",
					values: { iterations: 5 },
				}),
				node("end", "pass-repeat-output", {
					items: [
						{ id: "count", label: "Count", type: "f32" },
						{ id: "tex", label: "Tex", type: "texture", size: "scale", format: FORMAT },
					],
					values: { "scale:tex": 1 },
				}),
				declare("one", "f32", { x: 1 }),
				node("nextCount", "add"),
				declare("tenth", "vec4f", { x: 0.1, y: 0.1, z: 0.1, w: 0.1 }),
				node("nextTex", "add"),
				sampleOf("before", LINEAR, CLAMP),
				render("nextRender", FORMAT),
				sampleOf("final", LINEAR, CLAMP),
				node("split", "separate-vector"),
				declare("c", "vec4f", { w: 1 }),
			],
			[
				["zero", "value", "loop", "count"],
				["uv", "uv", "source", "item"],
				["source", "item", "loop", "tex"],
				["loop", "count", "nextCount", "operands"],
				["one", "value", "nextCount", "operands"],
				["nextCount", "result", "end", "count"],
				["loop", "tex", "before", "texture"],
				["uv", "uv", "before", "uv"],
				["before", "color", "nextTex", "operands"],
				["tenth", "value", "nextTex", "operands"],
				["nextTex", "result", "nextRender", "item"],
				["nextRender", "item", "end", "tex"],
				["end", "tex", "final", "texture"],
				["uv", "uv", "final", "uv"],
				["final", "color", "split", "v"],
				["end", "count", "c", "x"],
				["split", "x", "c", "y"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description:
				"A passes zone of a counter and a texture, five iterations: the counter counts 5, and the texture gains 0.1 each time, so its red is the UV's plus 0.5.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [
				pixelsCheck(
					CORNERS(4, 4).map(([x, y]) => {
						const [u] = uvAt(x, y, 4, 4);
						return px(x, y, 5, u + 0.5);
					}),
				),
			],
		},
	};
}

function passesNestedFixture(): Fixture {
	return {
		name: "feature-passes-nested",
		model: graph(
			[
				declare("zero", "f32"),
				node("outer", "pass-repeat-input", {
					pairedOutput: "outerEnd",
					values: { iterations: 3 },
				}),
				node("outerEnd", "pass-repeat-output", {
					items: [{ id: "count", label: "Count", type: "f32" }],
				}),
				node("inner", "pass-repeat-input", {
					pairedOutput: "innerEnd",
					values: { iterations: 2 },
				}),
				node("innerEnd", "pass-repeat-output", {
					items: [{ id: "count", label: "Count", type: "f32" }],
				}),
				declare("one", "f32", { x: 1 }),
				node("next", "add"),
			],
			[
				["zero", "value", "outer", "count"],
				["outer", "count", "inner", "count"],
				["inner", "count", "next", "operands"],
				["one", "value", "next", "operands"],
				["next", "result", "innerEnd", "count"],
				["innerEnd", "count", "outerEnd", "count"],
				["outerEnd", "count", "out", "color"],
			],
		),
		expect: {
			description:
				"A passes zone inside another: 3 outer iterations of 2 inner ones, each adding 1, come to 6.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, 6)])],
		},
	};
}

// Simulation zones

/** A simulation zone adding each frame's `delta-time` to its f32 accumulator, read back each frame. */
function simulationFixture(
	name: string,
	frames: Frame[],
	expected: number[],
	description: string,
): Fixture {
	return {
		name,
		model: graph(
			[
				node("state", "simulation-input", { pairedOutput: "stateEnd", values: { acc: 0 } }),
				node("stateEnd", "simulation-output", {
					items: [{ id: "acc", label: "Acc", type: "f32" }],
				}),
				node("next", "add"),
			],
			[
				["state", "acc", "next", "operands"],
				["state", "delta-time", "next", "operands"],
				["next", "result", "stateEnd", "acc"],
				["stateEnd", "acc", "out", "color"],
			],
		),
		expect: {
			description,
			size: { width: 4, height: 4 },
			format: FORMAT,
			frames,
			checks: expected.map((value, i) =>
				pixelsCheck([px(0, 0, value)], i, { abs: 1e-6, rel: 0 }),
			),
		},
	};
}

function simulationItemTypesFixture(): Fixture {
	const frames = timed([
		[0, 0],
		[1, 0.25],
		[2, 0.5],
		[3, 0.75],
	]);
	return {
		name: "feature-sim-item-types",
		model: graph(
			[
				node("state", "simulation-input", {
					pairedOutput: "stateEnd",
					values: { acc: 0, count: 0 },
				}),
				node("stateEnd", "simulation-output", {
					items: [
						{ id: "acc", label: "Acc", type: "f32" },
						{ id: "count", label: "Count", type: "i32" },
						{ id: "drift", label: "Drift", type: "vec3f" },
					],
				}),
				declare("zero", "vec3f"),
				declare("stepV", "vec3f", { x: 1 }),
				declare("one", "i32", { x: 1 }),
				node("nextAcc", "add"),
				node("nextCount", "add"),
				node("nextDrift", "add"),
				node("drift", "separate-vector"),
				node("countFloat", "to-float"),
				declare("c", "vec4f", { w: 1 }),
			],
			[
				["state", "acc", "nextAcc", "operands"],
				["state", "delta-time", "nextAcc", "operands"],
				["nextAcc", "result", "stateEnd", "acc"],
				["zero", "value", "state", "drift"],
				["state", "drift", "nextDrift", "operands"],
				["stepV", "value", "nextDrift", "operands"],
				["nextDrift", "result", "stateEnd", "drift"],
				["state", "count", "nextCount", "operands"],
				["one", "value", "nextCount", "operands"],
				["nextCount", "result", "stateEnd", "count"],
				["stateEnd", "acc", "c", "x"],
				["stateEnd", "count", "countFloat", "e"],
				["countFloat", "result", "c", "y"],
				["stateEnd", "drift", "drift", "v"],
				["drift", "x", "c", "z"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description:
				"A simulation zone with an i32 and a vec3f item, four frames: the counter counts each frame from its start, the vec3f drifts by 1 in x, and the delta time is the step since the last frame.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			frames,
			checks: frames.map((_, i) =>
				pixelsCheck([px(0, 0, i * 0.25, i + 1, i + 1, 1)], i, { abs: 1e-6, rel: 0 }),
			),
		},
	};
}

function previousFrameFixture(): Fixture {
	const time = (i: number) => 0.1 + 0.25 * i;
	const frames = frameRun(5).map((f) => ({ ...f, time: time(f.frame) }));
	return {
		name: "feature-previous-frame",
		model: graph(
			[
				node("clock", "time"),
				node("uv", "uv"),
				declare("drawn", "vec4f", { w: 1 }),
				render("source", FORMAT),
				{ id: "keep", type: "node-group", data: {}, group: "std-previous-frame" },
				sample("prevRead"),
				sample("curRead"),
				node("prevColor", "separate-vector"),
				node("curColor", "separate-vector"),
				declare("c", "vec4f", { w: 1 }),
			],
			[
				["clock", "seconds", "drawn", "x"],
				["drawn", "value", "source", "item"],
				["source", "item", "keep", socket("std-previous-frame", "inputs", "Texture")],
				["uv", "uv", "prevRead", "uv"],
				["uv", "uv", "curRead", "uv"],
				[
					"keep",
					socket("std-previous-frame", "outputs", "Previous"),
					"prevRead",
					"texture",
				],
				["keep", socket("std-previous-frame", "outputs", "Current"), "curRead", "texture"],
				["prevRead", "color", "prevColor", "v"],
				["curRead", "color", "curColor", "v"],
				["prevColor", "x", "c", "x"],
				["curColor", "x", "c", "y"],
				["c", "value", "out", "color"],
			],
		),
		expect: {
			description:
				"The Previous Frame group over five frames of a time-varying texture: Previous is the last frame's texture, Current this frame's. The first frame starts from its input, so Previous is that too. The state is half floats, hence the 1e-3 tolerance.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			frames,
			checks: frames.map((_, i) =>
				pixelsCheck([px(0, 0, time(Math.max(i - 1, 0)), time(i))], i, {
					abs: 1e-3,
					rel: 0,
				}),
			),
		},
	};
}

// Output

function outputFixture(
	name: string,
	type: SocketType,
	values: Value,
	expected: [number, number, number, number],
	description: string,
): Fixture {
	return {
		name,
		model: graph([declare("c", type, values)], [["c", "value", "out", "color"]]),
		expect: {
			description,
			size: { width: 4, height: 4 },
			format: FORMAT,
			checks: [pixelsCheck([px(0, 0, ...expected), px(3, 3, ...expected)])],
		},
	};
}

function colorSpaceFixture(colorSpace: "srgb" | "display-p3"): Fixture {
	return {
		name: `feature-color-space-${colorSpace}`,
		model: graph(
			[
				declare("colour", "vec3f", { x: 1.2, y: 0.5, z: -0.1 }),
				node("clip", "display-gamut-clip"),
			],
			[
				["colour", "value", "clip", "color"],
				["clip", "color", "out", "color"],
			],
		),
		expect: {
			description: `A colour outside sRGB, clipped to the ${colorSpace} display gamut: the GPU and the CPU agree on the clipped value.`,
			size: { width: 4, height: 4 },
			format: FORMAT,
			colorSpace,
			checks: [cpuCheck()],
		},
	};
}

// Robustness

function robustFixture(name: string, size: number, iterations: number, stride: number): Fixture {
	const shift = 1 / 8;
	return {
		name,
		model: offsetLoopGraph(iterations, shift),
		expect: {
			description: `The offset loop on a ${String(size)} by ${String(size)} canvas: texel rows and columns keep their place, and the far corner is read.`,
			size: { width: size, height: size },
			format: FORMAT,
			checks: [
				pixelsCheck([
					px(size - 1, size - 1, (size - 1 + 0.5) / size, 1 - (size - 1 + 0.5) / size),
				]),
				cpuCheck(undefined, stride),
			],
		},
	};
}

// Writing

function writeFile(path: string, data: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, data);
}

async function write({ name, model, expect }: Fixture): Promise<void> {
	const dir = join(FIXTURES, name);
	rmSync(dir, { recursive: true, force: true });
	await parseGpuFixture(expect);
	const project: unknown = JSON.parse(model.getProjectJson());
	writeFile(join(dir, "project.json"), `${JSON.stringify(project, null, "\t")}\n`);
	writeFile(join(dir, "expect.json"), `${JSON.stringify(expect, null, "\t")}\n`);
}

const fixtures: Fixture[] = [
	frameInputsFixture(),
	resolutionFixture(1, 1),
	resolutionFixture(7, 3),
	resolutionFixture(64, 64),
	resolutionFixture(1920, 1080),
	...TEXTURE_FORMATS.map((format) => formatFixture(format)),
	sizeScaleFixture(),
	sizePixelsFixture(),
	sizeLikeFixture(),
	chainFixture(),
	sampleFixture(LINEAR, CLAMP),
	sampleFixture(LINEAR, REPEAT),
	sampleFixture(LINEAR, MIRROR),
	sampleFixture(LINEAR, TRANSPARENT),
	sampleFixture(CLOSEST, CLAMP),
	sampleFixture(CLOSEST, REPEAT),
	sampleFixture(CLOSEST, MIRROR),
	sampleFixture(CLOSEST, TRANSPARENT),
	loadTexelFixture(
		"feature-load-texel-in-range",
		[2, 1],
		0,
		"Load Texel of a 4 by 4 texture at texel (2, 1) gives that texel's UV: the texel's centre.",
	),
	loadTexelFixture(
		"feature-load-texel-out-of-range",
		[-3, 9],
		0,
		"Load Texel at texel (-3, 9) of a 4 by 4 texture clamps into it: the corner texel (0, 3).",
	),
	loadTexelFixture(
		"feature-load-texel-level-out-of-range",
		[2, 1],
		9,
		"Load Texel at mip level 9 of a texture with one level clamps to level 0: the same texel as level 0.",
	),
	mipFixture("feature-mips-level-2", 2),
	mipFixture("feature-mips-level-2-5", 2.5),
	mipFixture("feature-mips-level-6", 6),
	textureSizeLevelFixture(
		"feature-texture-size-level-3",
		3,
		12,
		7,
		"Texture Size of a 100 by 60 texture with mips at level 3 is 12 by 7, of the 7 levels it has.",
	),
	textureSizeLevelFixture(
		"feature-texture-size-level-clamped",
		9,
		1,
		1,
		"Texture Size at level 9 of a 100 by 60 texture clamps to its last level, 1 by 1.",
	),
	repeatFixture(
		"feature-repeat-zero-iterations",
		0,
		5,
		1,
		"A repeat zone with 0 iterations gives its initial value.",
		5,
	),
	repeatFixture(
		"feature-repeat-one-iteration",
		1,
		5,
		1,
		"A repeat zone of one iteration adds its step once.",
		6,
	),
	repeatFixture(
		"feature-repeat-many-iterations",
		1000,
		5,
		1,
		"A repeat zone of 1000 iterations adds its step 1000 times.",
		1005,
	),
	repeatNestedFixture(),
	repeatFrameCountFixture(),
	repeatStateTypesFixture(),
	offsetLoopFixture("feature-passes-zero-iterations", 0, 8),
	offsetLoopFixture("feature-passes-offset-read-3", 3, 8),
	passesManyItemsFixture(),
	passesNestedFixture(),
	simulationFixture(
		"feature-sim-accumulate",
		frameRun(6),
		[0, 1 / 60, 2 / 60, 3 / 60, 4 / 60, 5 / 60],
		"A simulation accumulating its delta time over frames 0 to 5: frame 0 starts from the initial value, then each frame adds 1 / 60.",
	),
	simulationFixture(
		"feature-sim-frame-gaps",
		timed([
			[0, 0],
			[1, 0.1],
			[4, 0.5],
			[5, 0.6],
		]),
		[0, 0.1, 0.5, 0.6],
		"A simulation over skipped frames steps by all the time since the last frame it ran: its accumulator is the time.",
	),
	simulationFixture(
		"feature-sim-reset",
		timed([
			[0, 0],
			[1, 0.25],
			[2, 0.5],
			[0, 1],
			[1, 1.25],
		]),
		[0, 0.25, 0.5, 0, 0.25],
		"A simulation whose frame index goes back to 0 starts over from its initial value.",
	),
	simulationFixture(
		"feature-sim-repeat-frame",
		timed([
			[0, 0],
			[1, 0.25],
			[2, 0.5],
			[2, 0.5],
			[3, 0.75],
		]),
		[0, 0.25, 0.5, 0.5, 0.75],
		"A simulation drawing a frame again computes it from the same previous state, so the repeat gives the same value and the next frame steps on from it.",
	),
	simulationItemTypesFixture(),
	previousFrameFixture(),
	outputFixture(
		"feature-output-f32",
		"f32",
		{ x: 0.25 },
		[0.25, 0.25, 0.25, 1],
		"A f32 reaching the output is shown as grey, opaque.",
	),
	outputFixture(
		"feature-output-vec2f",
		"vec2f",
		{ x: 0.25, y: 0.75 },
		[0.25, 0.75, 0, 1],
		"A vec2f reaching the output fills red and green, with blue 0 and an opaque alpha.",
	),
	outputFixture(
		"feature-output-vec3f",
		"vec3f",
		{ x: 0.1, y: 0.2, z: 0.3 },
		[0.1, 0.2, 0.3, 1],
		"A vec3f reaching the output is opaque: its alpha is 1.",
	),
	outputFixture(
		"feature-output-vec4f-alpha",
		"vec4f",
		{ x: 0.2, y: 0.4, z: 0.6, w: 0.5 },
		[0.2, 0.4, 0.6, 0.5],
		"A vec4f with an alpha of 0.5 reaches the target with that alpha, unchanged.",
	),
	colorSpaceFixture("srgb"),
	colorSpaceFixture("display-p3"),
	robustFixture("feature-robust-1x1", 1, 3, 1),
	robustFixture("feature-robust-2048", 2048, 2, 524288),
];

for (const fixture of fixtures) await write(fixture);
console.log(`wrote ${String(fixtures.length)} fixtures to ${FIXTURES}`);
