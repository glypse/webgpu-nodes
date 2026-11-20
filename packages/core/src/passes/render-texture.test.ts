import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { generateRenderPlan, PLAN_TARGET } from "../codegen";
import { evaluateFrame } from "../frame/program";
import { ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { type CpuTexture, evaluate } from "../testing/evaluate";
import { managerFor, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";
import type { ZoneItem } from "../types";
import { type TextureSources } from "./sources";
import type { TextureFormat } from "./textures";

const image = (id: string, width = 4, height = 2): Asset => ({
	kind: "image",
	id,
	name: id,
	file: `assets/images/${id}.png`,
	mime: "image/png",
	bytes: 1,
	hash: id,
	width,
	height,
});

const color = (id: string, format: TextureFormat = "rgba16float"): ZoneItem => ({
	id,
	label: id,
	type: "vec4f",
	format,
});

/** A Render Texture `rt` of `data`, its item `color` read by Sample Texture `s` drawn as the frame. */
function drawn(
	data: TestNode["data"],
	feed: TestEdge[] = [],
	nodes: TestNode[] = [],
): [TestNode[], TestEdge[]] {
	return [
		[{ id: "rt", type: "render-texture", data }, { id: "s", type: "sample-texture" }, ...nodes],
		[...feed, ["rt", "color", "s", "texture"], ["s", "color", "out", "color"]],
	];
}

function expectValid(model: GraphModel) {
	if (nagaBin) expect(validatePlan(generateRenderPlan(model))).toEqual([]);
}

describe("Render Texture", () => {
	it("draws a value at a scale of the canvas, in a pass before the frame's", () => {
		const [nodes, edges] = drawn(
			{ values: { scale: 0.5 } },
			[["uv", "uv", "rt", "color"]],
			[{ id: "uv", type: "uv" }],
		);
		const model = managerFor(nodes, edges);
		const plan = generateRenderPlan(model);
		expect(plan.passes.map((p) => p.writes)).toEqual([["render:rt:color"], [PLAN_TARGET]]);
		expect(plan.passes[1]?.reads).toEqual(["render:rt:color"]);
		expect(plan.resources).toContainEqual({
			id: "render:rt:color",
			kind: "transient",
			size: { kind: "scale", scale: 0.5, of: "canvas" },
			format: "rgba16float",
		});
		expectValid(model);
	});

	it("is relative to the texture linked to its item, or to `like`", () => {
		const project = (like: boolean) =>
			new GraphModel({
				...rootProject(
					...drawn(
						{ values: { scale: 0.25 } },
						[["img", "texture", "rt", like ? "like" : "color"]],
						[{ id: "img", type: "image", data: { asset: "a" } }],
					),
				),
				assets: [image("a")],
			});
		for (const like of [false, true]) {
			const model = project(like);
			const plan = generateRenderPlan(model);
			expect(plan.resources).toContainEqual({
				id: "render:rt:color",
				kind: "transient",
				size: { kind: "scale", scale: 0.25, of: { resource: "media:a" } },
				format: "rgba16float",
			});
			expect(plan.resources.map((r) => r.id)).toContain("media:a");
			expectValid(model);
		}
	});

	it("takes its size in pixels from frame values", () => {
		const [nodes, edges] = drawn(
			{ settings: { mode: "pixels" } },
			[
				["res", "resolution", "half", "operands"],
				["k", "value", "half", "operands"],
				["half", "result", "rt", "pixels"],
			],
			[
				{ id: "res", type: "resolution" },
				{ id: "k", type: "declare", data: { values: { x: 0.5 } } },
				{ id: "half", type: "mul" },
			],
		);
		const model = managerFor(nodes, edges);
		const plan = generateRenderPlan(model);
		const resource = plan.resources.find((r) => r.id === "render:rt:color");
		expect(resource?.kind === "transient" && resource.size.kind).toBe("pixels");
		const values = evaluateFrame(plan.frame, {
			time: 0,
			delta: 0,
			frame: 0,
			canvas: { width: 640, height: 360 },
			passSize: { width: 640, height: 360 },
		});
		const size = resource?.kind === "transient" ? resource.size : undefined;
		expect(
			size?.kind === "pixels" && [values.arg(size.width), values.arg(size.height)],
		).toEqual([320, 180]);
		expectValid(model);
	});

	it("reads its size from uniforms, so editing it doesn't change the code", () => {
		const [nodes, edges] = drawn({ values: { scale: 0.5 } });
		const model = managerFor(nodes, edges);
		const before = generateRenderPlan(model, { uniformScopes: [ROOT_ID] });
		model.setInputValue("rt", "scale", 0.25);
		const after = generateRenderPlan(model, { uniformScopes: [ROOT_ID] });
		expect(after.passes.map((p) => p.program.code)).toEqual(
			before.passes.map((p) => p.program.code),
		);
		expect(after.uniforms.u_rt_scale).toBe(0.25);
		const resource = after.resources.find((r) => r.id === "render:rt:color");
		const size = resource?.kind === "transient" ? resource.size : undefined;
		const values = evaluateFrame(after.frame, {
			time: 0,
			delta: 0,
			frame: 0,
			canvas: { width: 8, height: 8 },
			passSize: { width: 8, height: 8 },
			uniforms: after.uniforms,
		});
		expect(size?.kind === "scale" && values.arg(size.scale)).toBe(0.25);
	});

	it("draws all its items in one pass", () => {
		const [nodes, edges] = drawn(
			{ items: [color("color"), color("second")] },
			[
				["uv", "uv", "rt", "color"],
				["t", "seconds", "rt", "second"],
				["rt", "second", "s2", "texture"],
				["s2", "color", "sum", "operands"],
				["s", "color", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
			[
				{ id: "uv", type: "uv" },
				{ id: "t", type: "time" },
				{ id: "s2", type: "sample-texture" },
				{ id: "sum", type: "add" },
			],
		);
		const model = managerFor(nodes, edges);
		const plan = generateRenderPlan(model);
		expect(plan.passes.map((p) => p.writes)).toEqual([
			["render:rt:color", "render:rt:second"],
			[PLAN_TARGET],
		]);
		expect(plan.passes[0]?.program.targets).toEqual(["vec4f", "vec4f"]);
		expectValid(model);
	});

	it("draws items in several passes past what one can write", () => {
		const ids = Array.from({ length: 10 }, (_, i) => `c${String(i)}`);
		const nodes: TestNode[] = [
			{
				id: "rt",
				type: "render-texture",
				data: { items: ids.map((id) => color(id, "rgba32float")) },
			},
			{ id: "uv", type: "uv" },
			{ id: "sum", type: "add" },
		];
		const edges: TestEdge[] = [];
		for (const [i, id] of ids.entries()) {
			edges.push(["uv", "uv", "rt", id]);
			// Every other item is read, so every pass of two is drawn.
			if (i % 2 === 0) {
				nodes.push({ id: `s${id}`, type: "sample-texture" });
				edges.push(["rt", id, `s${id}`, "texture"], [`s${id}`, "color", "sum", "operands"]);
			}
		}
		edges.push(["sum", "result", "out", "color"]);
		const model = managerFor(nodes, edges);
		const plan = generateRenderPlan(model);
		expect(plan.passes.map((p) => p.writes.length)).toEqual([2, 2, 2, 2, 2, 1]);
		expect(plan.passes[0]?.program.targets).toEqual(["vec4f", "vec4f"]);
		expectValid(model);
	});

	it("refuses a value computed per pixel for its scale", () => {
		const [nodes, edges] = drawn(
			{},
			[
				["uv", "uv", "x", "v"],
				["x", "x", "rt", "scale"],
			],
			[
				{ id: "uv", type: "uv" },
				{ id: "x", type: "separate-vector" },
			],
		);
		const model = managerFor(nodes, edges);
		const into = model.root.edges.find((e) => e.target === "rt");
		const link = into && model.frameValueAnalysis().link([], into);
		expect(link?.kind).toBe("invalid");
	});

	it("is made of the sources it's computed from", () => {
		const [nodes, edges] = drawn({});
		const model = managerFor(nodes, edges);
		const sources: TextureSources = model.passAnalysis().sources;
		const output = sources.output([], "rt", "color");
		expect(output.kind === "render" && output.draw?.run.map((i) => i.item)).toEqual(["color"]);
	});

	it("edits its items, dropping the links of those removed", () => {
		const [nodes, edges] = drawn({}, [["uv", "uv", "rt", "color"]], [{ id: "uv", type: "uv" }]);
		const model = managerFor(nodes, edges);
		const added = model.addRenderItem("rt", "f32", "r32float");
		expect(model.getRenderItems("rt").map((i) => i.format)).toEqual([
			"rgba16float",
			"r32float",
		]);
		expect(model.resolveNodeOutputs("rt").map((o) => o.id)).toEqual(["color", added?.id ?? ""]);
		model.removeRenderItem("rt", "color");
		expect(model.root.edges.some((e) => e.target === "rt")).toBe(false);
		expect(model.root.edges.some((e) => e.source === "rt")).toBe(false);
	});

	it("gives the means of the texels a smaller texture covers", () => {
		const [nodes, edges] = drawn(
			{ values: { scale: 0.5 } },
			[["img", "texture", "rt", "color"]],
			[{ id: "img", type: "image", data: { asset: "a" } }],
		);
		nodes[1] = { id: "s", type: "sample-texture", data: { values: { interpolation: 1 } } };
		const model = new GraphModel({ ...rootProject(nodes, edges), assets: [image("a")] });
		const source: CpuTexture = {
			width: 4,
			height: 2,
			texel: (x, y) => [x + 10 * y, 0, 0, 1],
		};
		const read = (u: number) =>
			evaluate(model, "s", "color", "srgb", [4, 2], {
				uv: [u, 0.5],
				images: new Map([["a", source]]),
			});
		expect(read(0.25)[0]).toBeCloseTo(5.5, 5);
		expect(read(0.75)[0]).toBeCloseTo(7.5, 5);
	});
});
