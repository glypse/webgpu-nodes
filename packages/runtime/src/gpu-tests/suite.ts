import {
	type Asset,
	DEFAULT_PLAYBACK,
	generateRenderPlan,
	type GraphModel,
	planKey,
	type TextureFormat,
	VIDEO_INTERVAL,
} from "$core";
import { BufferTarget, CanvasSource, Output, Quality, WebMOutputFormat } from "mediabunny";

import type { Size } from "../renderer";
import {
	addFrames,
	flowErrors,
	type FlowScene,
	imageAsset,
	MOTIONS,
	withFlatAreas,
} from "./flow-scenes";
import { graph, socket, type TestGpu, type TestLink, type TestNode } from "./harness";

/** A check of what the GPU draws, giving what it measured; it throws when that's wrong. */
export type GpuTest = { name: string; run: (gpu: TestGpu) => Promise<string> };

const number = (id: string, x: number): TestNode => ({
	id,
	type: "declare",
	data: { values: { x } },
});

function expectClose(what: string, value: number, expected: number, tolerance: number): string {
	const shown = `${what}: ${value.toFixed(4)}`;
	if (!(Math.abs(value - expected) <= tolerance)) {
		throw new Error(`${shown}, expected ${expected.toFixed(4)}`);
	}
	return shown;
}

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

function renderItem(format: TextureFormat) {
	return { items: [{ id: "item", label: "Item", type: "vec4f" as const, format }] };
}

const loopTests = (["value", "texture"] as const).map((kind): GpuTest => ({
	name: `A loop's ${kind} item keeps its content when its size changes every iteration`,
	run: async (gpu) => {
		const size = { width: 64, height: 64 };
		const shown: string[] = [];
		for (const iterations of [0, 1, 2, 3]) {
			const pixels = await gpu.draw(generateRenderPlan(halving(iterations, kind)), size);
			// The nearest texel of a texture an eighth of the size is up to 4 pixels away.
			shown.push(
				expectClose(`${String(iterations)} iterations`, pixels.at(63, 32)[0], 1, 0.08),
			);
		}
		return shown.join(", ");
	},
}));

const mipTest: GpuTest = {
	name: "Mip levels stay in place whatever the size",
	run: async (gpu) => {
		const shown: string[] = [];
		for (const height of [1080, 1023, 768]) {
			for (const level of [3, 5, 6]) {
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
				const pixels = await gpu.draw(generateRenderPlan(model), { width: 64, height });
				const y = Math.round(height * 0.9);
				const shift = (pixels.at(32, y)[1] - (1 - (y + 0.5) / height)) * height;
				// A half float's step at this value is about a pixel.
				shown.push(
					expectClose(`${String(height)} at level ${String(level)} (px)`, shift, 0, 1.5),
				);
			}
		}
		return shown.join(", ");
	},
};

const formatTest: GpuTest = {
	name: "A texture's format can change while its shader doesn't",
	run: async (gpu) => {
		const size = { width: 16, height: 16 };
		const keys = new Set<string>();
		const formats = ["rgba16float", "rgba8unorm", "rgba32float"] as const;
		for (const format of formats) {
			const plan = generateRenderPlan(
				graph(
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
			);
			keys.add(planKey(plan));
			await gpu.draw(plan, size);
		}
		if (keys.size !== formats.length) throw new Error("Formats share a plan's key.");
		return `${String(keys.size)} keys`;
	},
};

const sizeTest: GpuTest = {
	name: "A texture sized by another is right while its own size is read",
	run: async (gpu) => {
		const plan = generateRenderPlan(
			graph(
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
			),
		);
		const frame = { time: 0.25, delta: 1 / 60, frame: 15 };
		const pixels = await gpu.draw(plan, { width: 64, height: 64 }, frame);
		return expectClose("width", pixels.at(0, 0)[0], 8, 0);
	},
};

const groupLoopTest: GpuTest = {
	name: "A group in a repeat zone over frame values runs in every iteration",
	run: async (gpu) => {
		const remap = (label: string) => socket("std-remap", "inputs", label);
		const plan = generateRenderPlan(
			graph(
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
			),
		);
		const frame = { time: 3, delta: 1 / 60, frame: 180 };
		const pixels = await gpu.draw(plan, { width: 4, height: 4 }, frame);
		return expectClose("3 doubled 3 times", pixels.at(0, 0)[0], 24, 0);
	},
};

/** A WebM of frames each of its own grey, `index / frames`. */
async function greyVideo(frames: number, fps: number): Promise<Blob> {
	const canvas = new OffscreenCanvas(64, 64);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Couldn't create a 2D canvas.");
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new CanvasSource(canvas, { codec: "vp9", quality: new Quality("high") });
	output.addVideoTrack(source, { frameRate: fps });
	await output.start();
	for (let i = 0; i < frames; i++) {
		const grey = Math.round((255 * i) / frames);
		context.fillStyle = `rgb(${String(grey)} ${String(grey)} ${String(grey)})`;
		context.fillRect(0, 0, 64, 64);
		await source.add(i / fps, 1 / fps);
	}
	await output.finalize();
	if (!target.buffer) throw new Error("The video wasn't written.");
	return new Blob([target.buffer], { type: "video/webm" });
}

const videoTest: GpuTest = {
	name: "A video's current and previous frames are the ones asked for",
	run: async (gpu) => {
		const frames = 24;
		const fps = 30;
		gpu.addFile("greys", await greyVideo(frames, fps));
		const asset: Asset = {
			kind: "video",
			id: "greys",
			name: "greys",
			file: "assets/videos/greys.webm",
			mime: "video/webm",
			bytes: 1,
			hash: "greys",
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
		const plan = generateRenderPlan(
			graph(
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
			),
		);
		const compiled = await gpu.compile(plan);
		const wrong: string[] = [];
		const encoded = (linear: number) =>
			linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
		try {
			for (let i = 1; i < frames; i++) {
				const frame = { time: i / fps, delta: 1 / fps, frame: i };
				const pixels = await gpu.drawCompiled(compiled, { width: 8, height: 8 }, frame);
				const [now, before] = pixels.at(4, 4).map((v) => Math.round(encoded(v) * frames));
				if (now !== i || before !== i - 1) {
					wrong.push(`${String(i)}: ${String(now)}, ${String(before)}`);
				}
			}
		} finally {
			compiled.destroy();
		}
		if (wrong.length > 0) throw new Error(`frame: shown now, before: ${wrong.join("; ")}`);
		return `${String(frames - 1)} frames`;
	},
};

const FLOW_SIZE: Size = { width: 960, height: 540 };
/** Clear of the edges by more than anything moves and the windows of the coarser levels see. */
const FLOW_MARGIN = 80;

function opticalFlow(size: Size, values: Record<string, number> = {}): GraphModel {
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
		[imageAsset("previous", size), imageAsset("current", size)],
	);
}

/** Scenes with the mean error in pixels and the share of pixels off by over one that are fine. */
const FLOW_SCENES: (FlowScene & { mean: number; bad: number; values?: Record<string, number> })[] =
	[
		{ name: "0.6 px", motion: MOTIONS["0.6 px"], mean: 0.08, bad: 0.001 },
		{ name: "2.3 px", motion: MOTIONS["2.3 px"], mean: 0.08, bad: 0.001 },
		{ name: "9 px", motion: MOTIONS["9 px"], mean: 0.1, bad: 0.002 },
		{ name: "32 px", motion: MOTIONS["32 px"], mean: 0.3, bad: 0.01 },
		{ name: "a zoom", motion: MOTIONS.zoom, mean: 0.1, bad: 0.002 },
		{ name: "a rotation", motion: MOTIONS.rotation, mean: 0.1, bad: 0.002 },
		{ name: "two layers", motion: MOTIONS.layers, mean: 0.6, bad: 0.11 },
		{ name: "noise", motion: MOTIONS["2.3 px"], noise: 0.01, mean: 0.2, bad: 0.005 },
		{
			name: "flat areas",
			motion: MOTIONS["2.3 px"],
			texture: withFlatAreas,
			noise: 0.01,
			mean: 0.7,
			bad: 0.25,
		},
		{ name: "2 % brighter", motion: MOTIONS["2.3 px"], gain: 1.02, mean: 0.1, bad: 0.002 },
		{ name: "10 % brighter", motion: MOTIONS["2.3 px"], gain: 1.1, mean: 0.2, bad: 0.01 },
		{
			name: "16 iterations, window 2",
			motion: MOTIONS.zoom,
			values: { Iterations: 16, Window: 2 },
			mean: 0.2,
			bad: 0.005,
		},
	];

const flowTests = FLOW_SCENES.map((scene): GpuTest => ({
	name: `Optical Flow: ${scene.name}`,
	run: async (gpu) => {
		const { name, motion, mean, bad, values } = scene;
		await addFrames(gpu, scene, FLOW_SIZE, ["previous", "current"]);
		const plan = generateRenderPlan(opticalFlow(FLOW_SIZE, values));
		const errors = await flowErrors(gpu, plan, motion, FLOW_SIZE, FLOW_MARGIN);
		const shown = `mean ${errors.mean.toFixed(3)} px, p95 ${errors.p95.toFixed(2)} px, ${(errors.bad * 100).toFixed(1)} % off by over 1 px`;
		if (!(errors.mean <= mean && errors.bad <= bad)) throw new Error(`${name}: ${shown}`);
		return shown;
	},
}));

const flowTimeTest: GpuTest = {
	name: "Optical Flow's time at 1920×1080 (not checked)",
	run: async (gpu) => {
		const size = { width: 1920, height: 1080 };
		const scene = { name: "time", motion: MOTIONS["2.3 px"] };
		await addFrames(gpu, scene, size, ["previous", "current"]);
		const plan = generateRenderPlan(opticalFlow(size));
		return `${(await gpu.frameTime(plan, size)).toFixed(1)} ms a frame`;
	},
};

export const GPU_TESTS: readonly GpuTest[] = [
	...loopTests,
	mipTest,
	formatTest,
	sizeTest,
	groupLoopTest,
	videoTest,
	...flowTests,
	flowTimeTest,
];
