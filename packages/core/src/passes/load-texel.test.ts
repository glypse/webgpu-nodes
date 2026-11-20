import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { generateRenderPlan } from "../codegen";
import { GraphModel } from "../graph/model";
import { type CpuTexture, evaluate } from "../testing/evaluate";
import { managerFor, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";
import type { InputValue, ZoneItem } from "../types";

const asset: Asset = {
	kind: "image",
	id: "a",
	name: "a",
	file: "assets/images/a.png",
	mime: "image/png",
	bytes: 1,
	hash: "a",
	width: 4,
	height: 2,
};

/** Texels whose red is `x + 10 y`. */
const ramp: CpuTexture = { width: 4, height: 2, texel: (x, y) => [x + 10 * y, 0, 0, 1] };

function load(values: Record<string, InputValue>, data: TestNode["data"] = {}) {
	const model = new GraphModel({
		...rootProject(
			[
				{ id: "img", type: "image", data: { asset: "a" } },
				{ id: "lt", type: "load-texel", data: { ...data, values } },
			],
			[
				["img", "texture", "lt", "texture"],
				["lt", "value", "out", "color"],
			],
		),
		assets: [asset],
	});
	const read = (output = "value") =>
		evaluate(model, "lt", output, "srgb", [4, 2], { images: new Map([["a", ramp]]) });
	return { model, read };
}

describe("Load Texel", () => {
	it("reads the exact texel, rows down", () => {
		expect(load({ texel: { x: 3, y: 1 } }).read()).toEqual([13, 0, 0, 1]);
		expect(load({ texel: { x: 2, y: 0 } }).read()).toEqual([2, 0, 0, 1]);
	});

	it("clamps its coordinates into the texture", () => {
		expect(load({ texel: { x: 9, y: 9 } }).read()).toEqual([13, 0, 0, 1]);
		expect(load({ texel: { x: -4, y: -1 } }).read()).toEqual([0, 0, 0, 1]);
	});

	it("gives its value as the type picked, converted from the texture's", () => {
		const { model, read } = load(
			{ texel: { x: 1, y: 1 } },
			{ types: { "load-texel": "vec4i" } },
		);
		expect(model.resolveNodeOutputs("lt")[0]?.type).toBe("vec4i");
		expect(read()).toEqual([11, 0, 0, 1]);
	});

	it("reads a mip level, clamped to the levels there are", () => {
		const items: ZoneItem[] = [
			{ id: "color", label: "Color", type: "vec4f", format: "rgba32float" },
		];
		const model = new GraphModel({
			...rootProject(
				[
					{ id: "img", type: "image", data: { asset: "a" } },
					{ id: "rt", type: "render-texture", data: { items, settings: { mips: "on" } } },
					{
						id: "lt",
						type: "load-texel",
						data: { values: { texel: { x: 1, y: 0 }, level: 1 } },
					},
				],
				[
					["img", "texture", "rt", "color"],
					["rt", "color", "lt", "texture"],
					["lt", "value", "out", "color"],
				],
			),
			assets: [asset],
		});
		const options = { images: new Map([["a", ramp]]) };
		// A 4x2 texture's level 1 is 2x1: its second texel covers x 2 to 3.
		expect(evaluate(model, "lt", "value", "srgb", [4, 2], options)[0]).toBeCloseTo(
			(2 + 3 + 12 + 13) / 4,
			5,
		);
		model.setInputValue("lt", "level", 7);
		expect(evaluate(model, "lt", "value", "srgb", [4, 2], options)[0]).toBeCloseTo(
			(0 + 1 + 2 + 3 + 10 + 11 + 12 + 13) / 8,
			1,
		);
	});

	it("generates code that validates, for each type and each kind of texture", () => {
		for (const type of ["vec4f", "vec4i", "vec4u"] as const) {
			for (const format of ["rgba16float", "rgba32float", "r32uint", "rgba32sint"] as const) {
				const nodes: TestNode[] = [
					{ id: "uv", type: "uv" },
					{
						id: "rt",
						type: "render-texture",
						data: { items: [{ id: "c", label: "c", type: "vec4f", format }] },
					},
					{ id: "lt", type: "load-texel", data: { types: { "load-texel": type } } },
					{ id: "t", type: "time" },
				];
				const edges: TestEdge[] = [
					["uv", "uv", "rt", "c"],
					["rt", "c", "lt", "texture"],
					["t", "frame", "lt", "level"],
					["lt", "value", "out", "color"],
				];
				const plan = generateRenderPlan(managerFor(nodes, edges));
				const code = plan.passes.at(-1)?.program.code ?? "";
				expect(code).toContain("textureLoad(");
				expect(code).toContain("textureNumLevels(");
				if (nagaBin) expect(validatePlan(plan)).toEqual([]);
			}
		}
	});

	it("keeps integers a float can't hold", () => {
		const big = 4_000_000_001;
		const model = managerFor(
			[
				{
					id: "n",
					type: "declare",
					data: { types: { declare: "u32" }, values: { x: big } },
				},
				{
					id: "rt",
					type: "render-texture",
					data: { items: [{ id: "c", label: "c", type: "u32", format: "r32uint" }] },
				},
				{ id: "lt", type: "load-texel", data: { types: { "load-texel": "vec4u" } } },
			],
			[
				["n", "value", "rt", "c"],
				["rt", "c", "lt", "texture"],
				["lt", "value", "out", "color"],
			],
		);
		expect(evaluate(model, "lt", "value")[0]).toBe(big);
		const plan = generateRenderPlan(model);
		expect(plan.passes[0]?.program.targets).toEqual(["vec4u"]);
		expect(plan.passes[0]?.program.code).toContain(`u32(${String(big)})`);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});
});
