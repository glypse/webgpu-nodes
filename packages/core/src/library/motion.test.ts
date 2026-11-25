import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { generateRenderPlan, PLAN_TARGET, planPasses } from "../codegen";
import { GraphModel } from "../graph/model";
import { stateReadId } from "../passes/simulation";
import { type CpuTexture, evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, rootProject, type TestNode } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";

function imageAsset(id: string, width: number, height: number): Asset {
	return {
		kind: "image",
		id,
		name: id,
		file: `assets/images/${id}.png`,
		mime: "image/png",
		bytes: 1,
		hash: id,
		width,
		height,
	};
}

/** A texture of `width` by `height` texels, `texel(x, y)` with rows down. */
function image(
	width: number,
	height: number,
	texel: (x: number, y: number) => number[],
	id = "tex",
) {
	return { asset: imageAsset(id, width, height), texture: { width, height, texel } };
}

type Vector = { x: number; y: number; z: number };

/**
 * The group `id` with each texture fed to the input labelled by its key, its
 * `output` evaluated at `uv`.
 */
function evalGroup(
	id: string,
	textures: Record<string, { asset: Asset; texture: CpuTexture }>,
	output: string,
	{
		values = {},
		uv = [0.5, 0.5],
		resolution = [1, 1],
	}: {
		values?: Record<string, number | Vector>;
		uv?: [number, number];
		resolution?: [number, number];
	} = {},
): number[] {
	const entry = libraryEntry(id);
	const handle = (label: string) => libraryHandle(entry, "group-input", label);
	const fed = Object.entries(textures);
	const nodes: TestNode[] = fed.map(([label, { asset }]) => ({
		id: `img-${label}`,
		type: "image",
		data: { asset: asset.id },
	}));
	nodes.push({
		id: "g",
		type: "node-group",
		group: { definitionRef: entry.ref, locked: true },
		data: {
			values: Object.fromEntries(
				Object.entries(values).map(([label, v]) => [handle(label), v]),
			),
		},
	});
	const edges: [string, string, string, string][] = fed.map(([label]) => [
		`img-${label}`,
		"texture",
		"g",
		handle(label),
	]);
	const model = new GraphModel({
		...rootProject(nodes, edges),
		assets: fed.map(([, { asset }]) => asset),
	});
	if (nagaBin) expect(validatePlan(generateRenderPlan(model))).toEqual([]);
	const images = new Map(fed.map(([, { asset, texture }]) => [asset.id, texture]));
	return evaluate(model, "g", libraryHandle(entry, "group-output", output), "srgb", resolution, {
		uv,
		images,
	});
}

/** The group `id` fed `texture` at `inputs`, its `output` drawn to the frame. */
function groupGraph(
	id: string,
	texture: { asset: Asset },
	output: string,
	values: Record<string, number>,
	inputs: Record<string, string> = {},
) {
	const entry = libraryEntry(id);
	const handle = (label: string) => libraryHandle(entry, "group-input", label);
	const nodes: TestNode[] = [
		{ id: "img", type: "image", data: { asset: texture.asset.id } },
		{
			id: "g",
			type: "node-group",
			group: { definitionRef: entry.ref, locked: true },
			data: {
				values: Object.fromEntries(
					Object.entries(values).map(([label, v]) => [handle(label), v]),
				),
			},
		},
	];
	const edges: [string, string, string, string][] = [
		["img", "texture", "g", handle("Texture")],
		["g", libraryHandle(entry, "group-output", output), "out", "color"],
	];
	for (const [label, source] of Object.entries(inputs)) {
		edges.push([source, "value", "g", handle(label)]);
	}
	const model = new GraphModel({ ...rootProject(nodes, edges), assets: [texture.asset] });
	return { model, entry };
}

function run(
	model: GraphModel,
	entry: ReturnType<typeof libraryEntry>,
	output: string,
	asset: Asset,
	texture: CpuTexture,
	{ uv = [0.5, 0.5], resolution = [1, 1] as [number, number] } = {},
): number[] {
	if (nagaBin) expect(validatePlan(generateRenderPlan(model))).toEqual([]);
	return evaluate(model, "g", libraryHandle(entry, "group-output", output), "srgb", resolution, {
		uv: uv as [number, number],
		images: new Map([[asset.id, texture]]),
	});
}

describe("Luma", () => {
	it("weighs linear RGB by Rec. 709", () => {
		const entry = libraryEntry("std-luma");
		for (const [rgb, weight] of [
			[[1, 0, 0], 0.2126],
			[[0, 1, 0], 0.7152],
			[[0, 0, 1], 0.0722],
		] as const) {
			const model = rootProject(
				[
					{
						id: "g",
						type: "node-group",
						group: { definitionRef: entry.ref, locked: true },
						data: {
							values: {
								[libraryHandle(entry, "group-input", "Linear RGB")]: {
									x: rgb[0],
									y: rgb[1],
									z: rgb[2],
								},
							},
						},
					},
				],
				[["g", libraryHandle(entry, "group-output", "Luma"), "out", "color"]],
			);
			const graph = new GraphModel(model);
			const value = evaluate(graph, "g", libraryHandle(entry, "group-output", "Luma"));
			expect(value[0]).toBeCloseTo(weight, 6);
		}
	});
});

describe("Image Gradient", () => {
	const W = 8;
	const H = 8;
	// Luma rises by 0.1 per texel to the right, and by 0.05 per texel up,
	// which is towards row 0 (rows are drawn top first).
	const ramp = (x: number, y: number) => {
		const v = 0.1 * x + 0.05 * (H - 1 - y);
		return [v, v, v, 1];
	};
	const { asset, texture } = image(W, H, ramp);
	const uvOf = (x: number, y: number) => [(x + 0.5) / W, 1 - (y + 0.5) / H] as const;

	for (const scharr of [0, 1]) {
		it(`measures a linear ramp's slope per texel, in x and y with their signs (Scharr ${String(scharr)})`, () => {
			const { model, entry } = groupGraph("std-image-gradient", { asset }, "Gradient", {
				Scharr: scharr,
			});
			const gradient = run(model, entry, "Gradient", asset, texture, {
				uv: [...uvOf(3, 3)],
			});
			expect(gradient[0]).toBeCloseTo(0.1, 6);
			expect(gradient[1]).toBeCloseTo(0.05, 6);
		});
	}

	it("is per texel of the texture, not of the canvas", () => {
		const { model, entry } = groupGraph("std-image-gradient", { asset }, "Gradient", {});
		const gradient = run(model, entry, "Gradient", asset, texture, {
			uv: [...uvOf(4, 2)],
			resolution: [37, 11],
		});
		expect(gradient[0]).toBeCloseTo(0.1, 6);
		expect(gradient[1]).toBeCloseTo(0.05, 6);
	});
});

describe("Warp", () => {
	const W = 16;
	const H = 16;
	// Bilinear interpolation reproduces this exactly away from the edges.
	const ramp = (x: number, y: number) => [0.01 * x + 0.02 * y, 0, 0, 1];
	const { asset, texture } = image(W, H, ramp);
	/** The ramp at a UV point, between texel centres. */
	const at = (u: number, v: number) => 0.01 * (u * W - 0.5) + 0.02 * ((1 - v) * H - 0.5);

	const flowAsset = imageAsset("flow", 4, 4);
	const flowOf = (vx: number, vy: number): CpuTexture => ({
		width: 4,
		height: 4,
		texel: () => [vx, vy, 0, 1],
	});

	it("shows the texture at uv minus the flow times the amount", () => {
		for (const [vx, vy, amount] of [
			[0.1, -0.05, 2],
			[-0.12, 0.07, 1],
			[0.03, 0.2, 0.5],
		] as const) {
			const entry = libraryEntry("std-warp");
			const handle = (label: string) => libraryHandle(entry, "group-input", label);
			const model = new GraphModel({
				...rootProject(
					[
						{ id: "img", type: "image", data: { asset: asset.id } },
						{ id: "flow", type: "image", data: { asset: flowAsset.id } },
						{
							id: "g",
							type: "node-group",
							group: { definitionRef: entry.ref, locked: true },
							data: { values: { [handle("Amount")]: amount } },
						},
					],
					[
						["img", "texture", "g", handle("Texture")],
						["flow", "texture", "g", handle("Flow")],
						["g", libraryHandle(entry, "group-output", "Color"), "out", "color"],
					],
				),
				assets: [asset, flowAsset],
			});
			if (nagaBin) expect(validatePlan(generateRenderPlan(model))).toEqual([]);
			for (const uv of [
				[0.5, 0.5],
				[0.6, 0.3],
			] as const) {
				const [r = NaN] = evaluate(
					model,
					"g",
					libraryHandle(entry, "group-output", "Color"),
					"srgb",
					[1, 1],
					{
						uv: [...uv],
						images: new Map([
							[asset.id, texture],
							[flowAsset.id, flowOf(vx, vy)],
						]),
					},
				);
				expect(r).toBeCloseTo(at(uv[0] - vx * amount, uv[1] - vy * amount), 6);
			}
		}
	});
});

describe("Previous Frame", () => {
	it("keeps the input as a state sized like it, stepped each frame and read as the previous frame's", () => {
		const { asset } = image(8, 4, () => [0, 0, 0, 1]);
		const entry = libraryEntry("std-previous-frame");
		const handle = (label: string) => libraryHandle(entry, "group-input", label);
		const model = new GraphModel({
			...rootProject(
				[
					{ id: "img", type: "image", data: { asset: asset.id } },
					{
						id: "g",
						type: "node-group",
						group: { definitionRef: entry.ref, locked: true },
					},
					{ id: "uv", type: "uv" },
					{ id: "before", type: "sample-texture" },
					{ id: "now", type: "sample-texture" },
					{ id: "sum", type: "add" },
				],
				[
					["img", "texture", "g", handle("Texture")],
					["g", libraryHandle(entry, "group-output", "Previous"), "before", "texture"],
					["g", libraryHandle(entry, "group-output", "Current"), "now", "texture"],
					["uv", "uv", "before", "uv"],
					["uv", "uv", "now", "uv"],
					["before", "color", "sum", "operands"],
					["now", "color", "sum", "operands"],
					["sum", "result", "out", "color"],
				],
			),
			assets: [asset],
		});
		const plan = generateRenderPlan(model);
		const states = plan.resources.filter((r) => r.kind === "state");
		const textures = states
			.filter((s) => s.id.endsWith(":current"))
			.map((s) => s.id.slice(0, -":current".length));
		expect(textures).toHaveLength(2);
		for (const state of states) {
			expect(state.size).toEqual({
				kind: "scale",
				scale: 1,
				of: { resource: `media:${asset.id}` },
			});
		}
		// The evaluator doesn't step simulations, so the frame-to-frame content is
		// checked through what each pass reads and writes.
		const steps = planPasses(plan.passes).filter((p) => p.simulation?.stage === "step");
		expect(steps).toHaveLength(1);
		expect(steps[0]?.reads).toContain(`media:${asset.id}`);
		expect([...(steps[0]?.writes ?? [])].sort()).toEqual(
			textures.map((t) => stateReadId(t, "current")).sort(),
		);
		const frame = planPasses(plan.passes).find((p) => p.writes.includes(PLAN_TARGET));
		for (const texture of textures) {
			expect(frame?.reads).toContain(stateReadId(texture, "current"));
		}
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});
});

/** A flow texture holding `vector` everywhere. */
function constantFlow(id: string, [vx, vy]: readonly [number, number]) {
	return image(4, 4, () => [vx, vy, 0, 1], id);
}

/** sRGB's transfer function undone: the colours the groups output are linear. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

describe("Flow to Color", () => {
	const colourOf = (
		vector: readonly [number, number],
		max: number,
		resolution: [number, number] = [1, 1],
	) =>
		evalGroup("std-flow-to-color", { Flow: constantFlow("flow", vector) }, "Color", {
			values: { Max: max },
			resolution: [...resolution],
		});

	it("hues a direction by its angle, rightwards red and turning counterclockwise", () => {
		// Hue 1/4 is HSV's yellow-green, (0.5, 1, 0) in sRGB.
		const right = colourOf([0.5, 0], 0.5);
		expect(right[0]).toBeCloseTo(1, 6);
		expect(right[1]).toBeCloseTo(0, 6);
		expect(right[2]).toBeCloseTo(0, 6);
		const up = colourOf([0, 0.5], 0.5);
		expect(up[0]).toBeCloseTo(toLinear(0.5), 4);
		expect(up[1]).toBeCloseTo(1, 4);
		expect(up[2]).toBeCloseTo(0, 4);
		const left = colourOf([-0.5, 0], 0.5);
		expect(left[0]).toBeCloseTo(0, 6);
		expect(left[1]).toBeCloseTo(1, 4);
		expect(left[2]).toBeCloseTo(1, 4);
	});

	it("saturates by length over max, clamped at full", () => {
		// Half the length gives half the saturation: (1, 0.5, 0.5) in sRGB.
		const half = colourOf([0.05, 0], 0.1);
		expect(half[0]).toBeCloseTo(1, 6);
		expect(half[1]).toBeCloseTo(toLinear(0.5), 4);
		expect(half[2]).toBeCloseTo(toLinear(0.5), 4);
		const full = colourOf([0.5, 0], 0.1);
		expect(full[1]).toBeCloseTo(0, 6);
	});

	it("is white at rest and finite with a zero max", () => {
		expect(colourOf([0, 0], 0.1)).toEqual([1, 1, 1]);
		const atZeroMax = colourOf([0.2, 0], 0);
		expect(atZeroMax[0]).toBeCloseTo(1, 6);
		expect(atZeroMax[1]).toBeCloseTo(0, 6);
		expect(colourOf([0, 0], 0)).toEqual([1, 1, 1]);
	});

	it("measures length in fractions of the height, so a wide canvas saturates sooner", () => {
		// 0.05 across a canvas twice as wide as high is 0.1 of its height.
		const wide = colourOf([0.05, 0], 0.1, [200, 100]);
		expect(wide[1]).toBeCloseTo(0, 6);
		expect(wide[2]).toBeCloseTo(0, 6);
	});
});

describe("Flow Legend", () => {
	const legend = (uv: [number, number], resolution: [number, number] = [1, 1]) =>
		evalGroup("std-flow-legend", {}, "Color", { uv, resolution });

	it("is white and opaque at its centre, and transparent beyond the circle", () => {
		expect(legend([0.5, 0.5])).toEqual([1, 1, 1, 1]);
		expect(legend([0.9, 0.9], [100, 100])[3]).toBe(0);
	});

	it("saturates with distance from the centre, to the edge at half the height", () => {
		const inside = legend([0.8, 0.5], [100, 100]);
		expect(inside[0]).toBeCloseTo(1, 6);
		expect(inside[1]).toBeCloseTo(toLinear(0.4), 4);
		expect(inside[3]).toBe(1);
	});

	it("agrees with Flow to Color: a flow of the same size at the same place", () => {
		const uv: [number, number] = [0.7, 0.6];
		const [r = NaN, g = NaN, b = NaN, alpha = NaN] = legend(uv, [100, 100]);
		expect(alpha).toBe(1);
		const flow = evalGroup(
			"std-flow-to-color",
			{ Flow: constantFlow("flow", [0.2, 0.1]) },
			"Color",
			{ values: { Max: 0.5 } },
		);
		for (const [i, v] of [r, g, b].entries()) expect(v).toBeCloseTo(flow[i] ?? NaN, 6);
	});
});

describe("Motion Arrows", () => {
	const BASE = [0.2, 0.4, 0.6, 1];
	const base = image(4, 4, () => BASE, "colour");

	/** Arrows of a constant flow over a 2×2 grid of cells, `scale` times the flow. */
	const arrows = (
		vector: readonly [number, number],
		uv: [number, number],
		{ scale = 2, colour = base }: { scale?: number; colour?: typeof base } = {},
	) =>
		evalGroup(
			"std-motion-arrows",
			{ Colour: colour, Flow: constantFlow("flow", vector) },
			"Color",
			{
				values: { Cell: 0.5, Scale: scale, Thickness: 0.02 },
				uv,
				resolution: [400, 400],
			},
		);

	it("draws the arrow along its segment from the cell's centre", () => {
		// The centre of the lower-left cell is (0.25, 0.25) with a flow of 0.1 scaled
		// by 2, so the arrow runs to (0.45, 0.25).
		expect(arrows([0.1, 0], [0.35, 0.25])).toEqual([1, 1, 1, 1]);
		expect(arrows([0.1, 0], [0.25, 0.25])).toEqual([1, 1, 1, 1]);
	});

	it("leaves the colour input where no arrow is", () => {
		const off = arrows([0.1, 0], [0.35, 0.4]);
		expect(off[0]).toBeCloseTo(BASE[0] ?? NaN, 6);
		expect(off[1]).toBeCloseTo(BASE[1] ?? NaN, 6);
		expect(off[2]).toBeCloseTo(BASE[2] ?? NaN, 6);
		expect(off[3]).toBe(1);
	});

	it("draws a head at the tip, its barbs swept back from the direction", () => {
		// The head's tip is (0.45, 0.25); the barb above it runs back at 0.5 radians
		// from the shaft, 0.08 long, so its middle is at (0.4149, 0.2692).
		expect(arrows([0.1, 0], [0.4149, 0.2692])).toEqual([1, 1, 1, 1]);
	});

	it("draws arrows from neighbouring cells that reach into this one", () => {
		// The arrow from (0.25, 0.25) is 0.4 long, so it crosses into the next cell at x=0.6.
		expect(arrows([0.1, 0], [0.6, 0.25], { scale: 4 })).toEqual([1, 1, 1, 1]);
	});

	it("draws nothing and no NaN for zero motion", () => {
		const still = arrows([0, 0], [0.25, 0.25]);
		expect(still.every(Number.isFinite)).toBe(true);
		expect(still[0]).toBeCloseTo(BASE[0] ?? NaN, 6);
		expect(still[1]).toBeCloseTo(BASE[1] ?? NaN, 6);
		expect(still[2]).toBeCloseTo(BASE[2] ?? NaN, 6);
	});
});

describe("Flow Error", () => {
	const W = 16;
	const H = 16;
	// Luma of a grey texel: the weights sum to one, so this is the luma.
	const grey = (v: number) => [v, v, v, 1];
	const ramp = (x: number, y: number) => grey(0.01 * x + 0.02 * y);
	const previous = image(W, H, ramp, "previous");

	/** The flow of a texel shift: two to the right and one row down, as UV. */
	const shiftFlow = constantFlow("flow", [2 / W, 1 / H]);
	const errorAt = (
		current: (x: number, y: number) => number[],
		flow: ReturnType<typeof constantFlow>,
		uv: [number, number],
	) =>
		evalGroup(
			"std-flow-error",
			{
				Previous: previous,
				Current: image(W, H, current, "current"),
				Flow: flow,
			},
			"Error",
			{ uv },
		)[0] ?? NaN;

	it("is zero for a current frame that the flow carries the previous one to", () => {
		// The shifted frame's texel (x, y) is the previous one's (x - 2, y + 1).
		const shifted = (x: number, y: number) => ramp(x - 2, y + 1);
		for (const uv of [
			[0.5, 0.5],
			[0.7, 0.3],
		] as const) {
			expect(errorAt(shifted, shiftFlow, [...uv])).toBeCloseTo(0, 6);
		}
	});

	it("is the luma difference otherwise", () => {
		// Still flow, so the previous frame is compared at the same place: three steps of
		// 0.01 apart in x.
		const moved = (x: number, y: number) => ramp(x + 3, y);
		const still = constantFlow("flow", [0, 0]);
		expect(errorAt(moved, still, [0.5, 0.5])).toBeCloseTo(0.03, 6);
	});
});
