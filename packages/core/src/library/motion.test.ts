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
function image(width: number, height: number, texel: (x: number, y: number) => number[]) {
	return { asset: imageAsset("tex", width, height), texture: { width, height, texel } };
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
