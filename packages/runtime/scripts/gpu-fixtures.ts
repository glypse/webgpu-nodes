// Writes the GPU fixtures under fixtures/gpu from the graphs the TypeScript tests used to build.
// Run from packages/runtime: bun --conditions=development scripts/gpu-fixtures.ts

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

import { type Asset, DEFAULT_PLAYBACK, type GraphModel, VIDEO_INTERVAL } from "$core";
import type { GpuFixture, Motion } from "$core/testing";

import { parseGpuFixture } from "../src/gpu-tests/fixtures";
import { graph, socket, type TestLink, type TestNode } from "../src/gpu-tests/harness";
import type { Size } from "../src/renderer";

const FIXTURES = join(import.meta.dir, "../../../fixtures/gpu");
const FFMPEG = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg";

type ExpectFile = Partial<GpuFixture> & Pick<GpuFixture, "description" | "size" | "checks">;
type Pixel = Extract<GpuFixture["checks"][number], { kind: "pixels" }>["pixels"][number];
type Fixture = {
	name: string;
	model: GraphModel;
	expect: ExpectFile;
	files?: Map<string, Uint8Array>;
};

/** The format the TypeScript tests drew to, which the fixtures keep for the same precision. */
const FORMAT = "rgba16float";

const number = (id: string, x: number): TestNode => ({
	id,
	type: "declare",
	data: { values: { x } },
});

function renderItem(format: "rgba16float" | "rgba8unorm" | "rgba32float") {
	return { items: [{ id: "item", label: "Item", type: "vec4f" as const, format }] };
}

function pixel(x: number, y: number, r: number | null, g: number | null = null): Pixel {
	return { x, y, rgba: [r, g, null, null] };
}

// Loops

/** A loop halving its item each iteration, from the UV's x, given back as the frame. */
function halving(iterations: number, kind: "value" | "texture"): GraphModel {
	const item = { id: "item", label: "Item", type: kind === "value" ? "f32" : "texture" } as const;
	const feed: [TestNode[], TestLink[]] =
		kind === "value"
			? [[], [["x", "x", "start", "item"]]]
			: [
					[{ id: "drawn", type: "render-texture", data: renderItem("rgba16float") }],
					[
						["x", "x", "drawn", "item"],
						["drawn", "item", "start", "item"],
					],
				];
	return graph(
		[
			{
				id: "start",
				type: "pass-repeat-input",
				data: { pairedOutput: "end", values: { iterations } },
			},
			{
				id: "end",
				type: "pass-repeat-output",
				data: { items: [{ ...item, size: "scale" }] },
			},
			{ id: "uv", type: "uv" },
			{ id: "x", type: "separate-vector" },
			number("one", 1),
			number("half", 0.5),
			{ id: "next", type: "add" },
			{ id: "scale", type: "pow" },
			...feed[0],
		],
		[
			["uv", "uv", "x", "v"],
			["start", "item", "end", "item"],
			["end", "item", "out", "color"],
			["start", "iteration", "next", "operands"],
			["one", "value", "next", "operands"],
			["half", "value", "scale", "e1"],
			["next", "result", "scale", "e2"],
			["scale", "result", "end", "scale:item"],
			...feed[1],
		],
	);
}

function loopFixtures(): Fixture[] {
	const fixtures: Fixture[] = [];
	for (const kind of ["value", "texture"] as const) {
		for (const iterations of [0, 1, 2, 3]) {
			fixtures.push({
				name: `loop-${kind}-${String(iterations)}`,
				model: halving(iterations, kind),
				expect: {
					description: `A loop's ${kind} item after ${String(iterations)} iterations, which halve it, keeps its content when its size changes every iteration: the right edge is 1. The nearest texel of a texture an eighth of the size is up to 4 pixels away.`,
					size: { width: 64, height: 64 },
					format: FORMAT,
					checks: [
						{
							kind: "pixels",
							tolerance: { abs: 0.08, rel: 0 },
							pixels: [pixel(63, 32, 1)],
						},
					],
				},
			});
		}
	}
	return fixtures;
}

// Mip levels

function mipFixture(height: number, level: number): Fixture {
	const model = graph(
		[
			{ id: "uv", type: "uv" },
			{
				id: "drawn",
				type: "render-texture",
				data: {
					...renderItem("rgba16float"),
					settings: { mode: "scale", mips: "on" },
				},
			},
			{ id: "read", type: "sample-texture", data: { values: { level } } },
		],
		[
			["uv", "uv", "drawn", "item"],
			["drawn", "item", "read", "texture"],
			["read", "color", "out", "color"],
		],
	);
	const y = Math.round(height * 0.9);
	return {
		name: `mip-${String(height)}-level-${String(level)}`,
		model,
		expect: {
			description: `A ${String(height)} px tall texture sampled at mip level ${String(level)} stays in place: its green at 90 % of the height is the UV there, within 1.5 px. A half float's step at this value is about a pixel.`,
			size: { width: 64, height },
			format: FORMAT,
			checks: [
				{
					kind: "pixels",
					tolerance: { abs: 1.5 / height, rel: 0 },
					pixels: [pixel(32, y, null, 1 - (y + 0.5) / height)],
				},
			],
		},
	};
}

function mipFixtures(): Fixture[] {
	const fixtures: Fixture[] = [];
	for (const height of [1080, 1023, 768]) {
		for (const level of [3, 5, 6]) fixtures.push(mipFixture(height, level));
	}
	return fixtures;
}

// Formats

/**
 * A texture's format is part of its plan's key (see `planKey` in core), so
 * each format is drawn here and the loaded texel checked against the CPU.
 */
function formatFixture(format: "rgba16float" | "rgba8unorm" | "rgba32float"): Fixture {
	return {
		name: `format-${format}`,
		model: graph(
			[
				{ id: "uv", type: "uv" },
				{ id: "drawn", type: "render-texture", data: renderItem(format) },
				{ id: "read", type: "load-texel" },
			],
			[
				["uv", "uv", "drawn", "item"],
				["drawn", "item", "read", "texture"],
				["read", "value", "out", "color"],
			],
		),
		expect: {
			description: `A ${format} render texture read back by Load Texel: its top-left 4 by 4 texels match the CPU, within one 8-bit step.`,
			size: { width: 16, height: 16 },
			format: FORMAT,
			checks: [
				{
					kind: "cpu",
					region: { x: 0, y: 0, width: 4, height: 4 },
					stride: 1,
					maxOff: 0,
					tolerance: { abs: 1 / 255, rel: 0 },
				},
			],
		},
	};
}

// Size and group loop

function sizeFixture(): Fixture {
	const model = graph(
		[
			{ id: "time", type: "time" },
			{ id: "uv", type: "uv" },
			number("one", 1),
			{ id: "a", type: "render-texture", data: renderItem("rgba16float") },
			{
				id: "b",
				type: "render-texture",
				data: { ...renderItem("rgba16float"), values: { scale: 0.5 } },
			},
			{ id: "size", type: "texture-size" },
			{ id: "x", type: "separate-vector" },
			{ id: "scaled", type: "mul" },
		],
		[
			["time", "seconds", "a", "scale"],
			["uv", "uv", "a", "item"],
			["a", "item", "b", "item"],
			["b", "item", "size", "texture"],
			["size", "size", "x", "v"],
			["x", "x", "scaled", "operands"],
			["one", "value", "scaled", "operands"],
			["scaled", "result", "out", "color"],
		],
	);
	return {
		name: "texture-size-of-another",
		model,
		expect: {
			description:
				"A texture sized by another is right while its own size is read: a half-scale texture of a 64 px canvas is 8 px wide at this frame.",
			size: { width: 64, height: 64 },
			format: FORMAT,
			frames: [{ time: 0.25, delta: 1 / 60, frame: 15 }],
			checks: [{ kind: "pixels", tolerance: { abs: 0, rel: 0 }, pixels: [pixel(0, 0, 8)] }],
		},
	};
}

function groupLoopFixture(): Fixture {
	const remap = (label: string) => socket("std-remap", "inputs", label);
	const model = graph(
		[
			{ id: "time", type: "time" },
			{
				id: "start",
				type: "repeat-input",
				data: { pairedOutput: "end", values: { iterations: 3 } },
			},
			{
				id: "end",
				type: "repeat-output",
				data: { items: [{ id: "item", label: "Item", type: "f32" }] },
			},
			{
				id: "double",
				type: "node-group",
				group: "std-remap",
				data: {
					values: {
						[remap("From Min")]: 0,
						[remap("From Max")]: 1,
						[remap("To Min")]: 0,
						[remap("To Max")]: 2,
					},
				},
			},
		],
		[
			["time", "seconds", "start", "item"],
			["start", "item", "double", remap("Value")],
			["double", socket("std-remap", "outputs", "Result"), "end", "item"],
			["end", "item", "out", "color"],
		],
	);
	return {
		name: "group-in-repeat-zone",
		model,
		expect: {
			description:
				"A group in a repeat zone over frame values runs in every iteration: time 3 doubled three times is 24.",
			size: { width: 4, height: 4 },
			format: FORMAT,
			frames: [{ time: 3, delta: 1 / 60, frame: 180 }],
			checks: [{ kind: "pixels", tolerance: { abs: 0, rel: 0 }, pixels: [pixel(0, 0, 24)] }],
		},
	};
}

// Video

function srgbToLinear(encoded: number): number {
	return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/** WebM of `frames` frames of 64 by 64 greys, frame i being `round(255 * i / frames)`. */
async function encodeGreys(frames: number, fps: number): Promise<Uint8Array> {
	const process = Bun.spawn(
		[
			FFMPEG,
			"-v",
			"error",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"gray",
			"-s",
			"64x64",
			"-r",
			String(fps),
			"-i",
			"pipe:0",
			"-c:v",
			"libvpx-vp9",
			"-lossless",
			"1",
			"-r",
			String(fps),
			"-f",
			"webm",
			"pipe:1",
		],
		{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
	// Read while writing: the encoder's output would fill its pipe and stall the input.
	const output = new Response(process.stdout).arrayBuffer();
	const log = new Response(process.stderr).text();
	for (let i = 0; i < frames; i++) {
		void process.stdin.write(new Uint8Array(64 * 64).fill(Math.round((255 * i) / frames)));
	}
	await process.stdin.end();
	const [data, errors, code] = [await output, await log, await process.exited];
	if (code !== 0) throw new Error(`ffmpeg failed: ${errors}`);
	return new Uint8Array(data);
}

async function videoFixture(): Promise<Fixture> {
	const frames = 24;
	const fps = 30;
	const file = "assets/videos/greys.webm";
	const bytes = await encodeGreys(frames, fps);
	const asset: Asset = {
		kind: "video",
		id: "greys",
		name: "greys",
		file,
		mime: "video/webm",
		bytes: bytes.length,
		hash: sha256(bytes),
		width: 64,
		height: 64,
		duration: frames / fps,
		frameRate: fps,
	};
	const video = (id: string): TestNode => ({
		id,
		type: "video",
		data: { asset: "greys", playback: { ...DEFAULT_PLAYBACK, end: "hold" } },
	});
	const model = graph(
		[
			{ id: "time", type: "time" },
			video("now"),
			video("before"),
			{ id: "then", type: "sub" },
			{ id: "nowRead", type: "sample-texture" },
			{ id: "beforeRead", type: "sample-texture" },
			{ id: "nowX", type: "separate-vector" },
			{ id: "beforeX", type: "separate-vector" },
			{ id: "both", type: "declare", data: { types: { declare: "vec2f" } } },
		],
		[
			["time", "seconds", "now", "time"],
			["time", "seconds", "then", "a"],
			["now", VIDEO_INTERVAL, "then", "b"],
			["then", "result", "before", "time"],
			["now", "texture", "nowRead", "texture"],
			["before", "texture", "beforeRead", "texture"],
			["nowRead", "color", "nowX", "v"],
			["beforeRead", "color", "beforeX", "v"],
			["nowX", "x", "both", "x"],
			["beforeX", "x", "both", "y"],
			["both", "value", "out", "color"],
		],
		[asset],
	);

	const grey = (k: number) => Math.round((255 * k) / frames) / 255;
	const linear = (k: number) => srgbToLinear(grey(k));
	const levels = [...new Set(Array.from({ length: frames }, (_, k) => linear(k)))].sort(
		(a, b) => a - b,
	);
	let smallestStep = Infinity;
	for (let i = 1; i < levels.length; i++) {
		smallestStep = Math.min(smallestStep, (levels[i] ?? 0) - (levels[i - 1] ?? 0));
	}

	const indices = Array.from({ length: frames - 1 }, (_, j) => j + 1);
	return {
		name: "video-frames",
		model,
		expect: {
			description:
				"A video's current and previous frames are the ones asked for: each frame's red is the grey shown now and its green the one before, read at the centre.",
			size: { width: 8, height: 8 },
			format: FORMAT,
			frames: indices.map((i) => ({ time: i / fps, delta: 1 / fps, frame: i })),
			checks: indices.map((i) => ({
				kind: "pixels" as const,
				frame: i - 1,
				tolerance: { abs: smallestStep / 2, rel: 0 },
				pixels: [pixel(4, 4, linear(i), linear(i - 1))],
			})),
		},
		files: new Map([[file, bytes]]),
	};
}

// Optical flow

/** The motion of the pixel (x, y) of a canvas of `size`, in pixels, y down. */
function shiftAt(motion: Motion, x: number, y: number, { width, height }: Size): [number, number] {
	const cx = x - width / 2;
	const cy = y - height / 2;
	switch (motion.kind) {
		case "translate":
			return [motion.dx, motion.dy];
		case "zoom":
			return [cx * motion.rate, cy * motion.rate];
		case "rotate":
			return [-cy * motion.rate, cx * motion.rate];
		case "disc":
			return Math.hypot(cx, cy) < motion.radius ? motion.inside : motion.outside;
	}
}

function hash(x: number, y: number, seed: number): number {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1073741823)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const fx = ease(x - xi);
	const fy = ease(y - yi);
	const a = hash(xi, yi, seed);
	const b = hash(xi + 1, yi, seed);
	const c = hash(xi, yi + 1, seed);
	const d = hash(xi + 1, yi + 1, seed);
	return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Detail at every scale, as photographs have. */
function natural(x: number, y: number): number {
	let value = 0.5;
	let amplitude = 0.5;
	let frequency = 1 / 160;
	for (let octave = 0; octave < 6; octave++) {
		value += amplitude * (valueNoise(x * frequency, y * frequency, octave + 1) - 0.5);
		amplitude *= 0.55;
		frequency *= 2.03;
	}
	return value;
}

/** `natural`, with large areas of one colour. */
function withFlatAreas(x: number, y: number): number {
	return valueNoise(x / 260, y / 260, 99) > 0.55 ? 0.62 : natural(x, y);
}

/** Random, but the same on every run. */
function randomNumbers(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Scene = {
	name: string;
	motion: Motion;
	texture?: (x: number, y: number) => number;
	/** What the current frame's brightness is multiplied by. */
	gain?: number;
	/** The amplitude of the noise of each frame, of 1. */
	noise?: number;
	values?: Record<string, number>;
	mean: number;
	bad: number;
};

const translate = (dx: number, dy: number): Motion => ({ kind: "translate", dx, dy });
const ZOOM: Motion = { kind: "zoom", rate: 0.03 };
const ROTATION: Motion = { kind: "rotate", rate: 0.03 };
const LAYERS: Motion = {
	kind: "disc",
	radius: 540 / 4,
	inside: [10, 0],
	outside: [-4, 2],
};

const SCENES: Scene[] = [
	{ name: "flow-0-6-px", motion: translate(0.5, -0.3), mean: 0.08, bad: 0.001 },
	{ name: "flow-2-3-px", motion: translate(2, 1.2), mean: 0.08, bad: 0.001 },
	{ name: "flow-9-px", motion: translate(8, -5), mean: 0.1, bad: 0.002 },
	{ name: "flow-32-px", motion: translate(28, -16), mean: 0.3, bad: 0.01 },
	{ name: "flow-zoom", motion: ZOOM, mean: 0.1, bad: 0.002 },
	{ name: "flow-rotation", motion: ROTATION, mean: 0.1, bad: 0.002 },
	{ name: "flow-two-layers", motion: LAYERS, mean: 0.6, bad: 0.11 },
	{
		name: "flow-noise",
		motion: translate(2, 1.2),
		noise: 0.01,
		mean: 0.2,
		bad: 0.005,
	},
	{
		name: "flow-flat-areas",
		motion: translate(2, 1.2),
		texture: withFlatAreas,
		noise: 0.01,
		mean: 0.7,
		bad: 0.25,
	},
	{
		name: "flow-2-percent-brighter",
		motion: translate(2, 1.2),
		gain: 1.02,
		mean: 0.1,
		bad: 0.002,
	},
	{
		name: "flow-10-percent-brighter",
		motion: translate(2, 1.2),
		gain: 1.1,
		mean: 0.2,
		bad: 0.01,
	},
	{
		name: "flow-16-iterations-window-2",
		motion: ZOOM,
		values: { Iterations: 16, Window: 2 },
		mean: 0.2,
		bad: 0.005,
	},
];

const TIMING_SCENE: Scene = { name: "flow-time-1080p", motion: translate(2, 1.2), mean: 0, bad: 0 };

/** Two 8-bit RGBA PNGs: the previous and current frames of `scene`. */
function renderPair(scene: Scene, size: Size): { previous: Uint8Array; current: Uint8Array } {
	const { width, height } = size;
	const { motion, texture = natural, gain = 1, noise = 0 } = scene;
	const before = new Uint8ClampedArray(width * height * 4);
	const after = new Uint8ClampedArray(width * height * 4);
	const random = randomNumbers(1);
	const grain = () => noise * (random() + random() - 1);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [dx, dy] = shiftAt(motion, x + 0.5, y + 0.5, size);
			const a = texture(x + 0.5, y + 0.5) + grain();
			const b = texture(x + 0.5 - dx, y + 0.5 - dy) * gain + grain();
			const i = (y * width + x) * 4;
			// Clamped and rounded by the typed array, as the canvas did.
			before.fill(a * 255, i, i + 3);
			after.fill(b * 255, i, i + 3);
			before[i + 3] = after[i + 3] = 255;
		}
	}
	return { previous: encodePng(width, height, before), current: encodePng(width, height, after) };
}

function flowFixture(scene: Scene, size: Size, timed: boolean): Fixture {
	const { previous, current } = renderPair(scene, size);
	const files = new Map([
		["assets/images/previous.png", previous],
		["assets/images/current.png", current],
	]);
	const model = opticalFlow(size, [previous, current], scene.values);
	const description = `Optical Flow of ${scene.name.replace(/^flow-/, "").replace(/-/g, " ")} at ${String(size.width)} by ${String(size.height)}: the flow it draws matches the motion of the frames.`;
	return {
		name: timed ? "flow-time-1080p" : scene.name,
		model,
		expect: {
			description: timed
				? "Optical Flow's time at 1920 by 1080, measured and not checked."
				: description,
			size,
			format: FORMAT,
			checks: timed
				? []
				: [
						{
							kind: "flow",
							motion: scene.motion,
							margin: 80,
							maxMean: scene.mean,
							maxOff: scene.bad,
						},
					],
			timed,
		},
		files,
	};
}

function opticalFlow(
	size: Size,
	[previous, current]: [Uint8Array, Uint8Array],
	values: Record<string, number> = {},
): GraphModel {
	const flow = "std-optical-flow";
	return graph(
		[
			{ id: "previous", type: "image", data: { asset: "previous" } },
			{ id: "current", type: "image", data: { asset: "current" } },
			{
				id: "flow",
				type: "node-group",
				group: flow,
				data: {
					values: Object.fromEntries(
						Object.entries(values).map(([k, v]) => [socket(flow, "inputs", k), v]),
					),
				},
			},
			{ id: "read", type: "sample-texture" },
		],
		[
			["previous", "texture", "flow", socket(flow, "inputs", "Previous")],
			["current", "texture", "flow", socket(flow, "inputs", "Current")],
			["flow", socket(flow, "outputs", "Flow"), "read", "texture"],
			["read", "color", "out", "color"],
		],
		[imageAsset("previous", size, previous), imageAsset("current", size, current)],
	);
}

function imageAsset(id: string, { width, height }: Size, bytes: Uint8Array): Asset {
	return {
		kind: "image",
		id,
		name: id,
		file: `assets/images/${id}.png`,
		mime: "image/png",
		bytes: bytes.length,
		hash: sha256(bytes),
		width,
		height,
	};
}

// PNG

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** 8 bits a channel, RGBA, no filtering. */
function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
	const stride = width * 4;
	const scanlines = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		scanlines.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8;
	header[9] = 6;
	const chunks = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
		pngChunk("IEND", new Uint8Array()),
	];
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const png = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		png.set(chunk, offset);
		offset += chunk.length;
	}
	return png;
}

// Writing

function writeFile(path: string, data: string | Uint8Array) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, data);
}

async function write({ name, model, expect, files = new Map() }: Fixture): Promise<void> {
	const dir = join(FIXTURES, name);
	rmSync(dir, { recursive: true, force: true });
	await parseGpuFixture(expect);
	writeFile(
		join(dir, "project.json"),
		`${JSON.stringify(JSON.parse(model.getProjectJson()), null, "\t")}\n`,
	);
	writeFile(join(dir, "expect.json"), `${JSON.stringify(expect, null, "\t")}\n`);
	for (const [file, bytes] of files) writeFile(join(dir, file), bytes);
}

const fixtures: Fixture[] = [
	...loopFixtures(),
	...mipFixtures(),
	formatFixture("rgba16float"),
	formatFixture("rgba8unorm"),
	formatFixture("rgba32float"),
	sizeFixture(),
	groupLoopFixture(),
	await videoFixture(),
	...SCENES.map((scene) => flowFixture(scene, { width: 960, height: 540 }, false)),
	flowFixture(TIMING_SCENE, { width: 1920, height: 1080 }, true),
];

for (const fixture of fixtures) await write(fixture);
console.log(`wrote ${String(fixtures.length)} fixtures to ${FIXTURES}`);
