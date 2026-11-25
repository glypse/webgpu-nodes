import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { generateRenderPlan, PLAN_TARGET, planPasses } from "../codegen";
import { evaluateFrame } from "../frame/program";
import { GraphModel } from "../graph/model";
import { managerFor, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";
import type { ZoneItem } from "../types";
import { stateReadId, stateTextureId } from "./simulation";
import { CANVAS_SIZE } from "./textures";

const ref = { path: [], zone: "s_in" };
const stateId = (item: string, read: "previous" | "current" = "current") =>
	stateReadId(stateTextureId(ref, item), read);

const f32 = (id: string, size?: ZoneItem["size"]): ZoneItem => ({
	id,
	label: id,
	type: "f32",
	...(size ? { size } : {}),
});

const image: Asset = {
	kind: "image",
	id: "a",
	name: "a",
	file: "assets/images/a.png",
	mime: "image/png",
	bytes: 1,
	hash: "a",
	width: 64,
	height: 32,
};

/** A simulation `acc += delta`, and `total += acc`, drawn as the frame as their sum. */
function simulation(
	acc?: ZoneItem["size"],
	total?: ZoneItem["size"],
	inputData: TestNode["data"] = {},
	extra: { nodes?: TestNode[]; edges?: TestEdge[] } = {},
): GraphModel {
	const [nodes, edges] = [
		[
			{
				id: "s_in",
				type: "simulation-input",
				data: { pairedOutput: "s_out", ...inputData },
			},
			{
				id: "s_out",
				type: "simulation-output",
				data: { items: [f32("acc", acc), f32("total", total)] },
			},
			{ id: "grow", type: "add" },
			{ id: "sum", type: "add" },
			{ id: "both", type: "add" },
			...(extra.nodes ?? []),
		] satisfies TestNode[],
		[
			["s_in", "acc", "grow", "operands"],
			["s_in", "delta-time", "grow", "operands"],
			["grow", "result", "s_out", "acc"],
			["s_in", "total", "sum", "operands"],
			["s_in", "acc", "sum", "operands"],
			["sum", "result", "s_out", "total"],
			["s_out", "total", "both", "operands"],
			["s_out", "acc", "both", "operands"],
			["both", "result", "out", "color"],
			...(extra.edges ?? []),
		] satisfies TestEdge[],
	];
	return new GraphModel({ ...rootProject(nodes, edges), assets: [image] });
}

const stateOf = (plan: ReturnType<typeof generateRenderPlan>, id: string) => {
	const resource = plan.resources.find((r) => r.id === id);
	return resource?.kind === "state" ? resource : undefined;
};

describe("sized simulation items", () => {
	it("are canvas-sized unless set", () => {
		const plan = generateRenderPlan(simulation());
		const states = plan.resources.filter((r) => r.kind === "state");
		expect(states.length).toBeGreaterThan(0);
		for (const state of states) expect(state.size).toEqual(CANVAS_SIZE);
	});

	it("take pixels from the input they have for it, a pass of its own for each size", () => {
		const model = simulation("pixels", undefined, {
			values: { "pixels:acc": { x: 1024, y: 1 } },
		});
		const plan = generateRenderPlan(model);
		expect(stateOf(plan, stateId("acc"))?.size).toEqual({
			kind: "pixels",
			width: 1024,
			height: 1,
		});
		const steps = planPasses(plan.passes).filter((p) => p.simulation?.stage === "step");
		expect(steps.map((p) => p.writes)).toEqual([[stateId("acc")], [stateId("total")]]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("is read by a canvas-sized pass at the nearest texel", () => {
		const model = simulation("pixels", undefined, {
			values: { "pixels:acc": { x: 1024, y: 1 } },
		});
		const plan = generateRenderPlan(model);
		const total = planPasses(plan.passes).find((p) => p.writes.includes(stateId("total")));
		expect(total?.program.code).toContain("textureDimensions");
		expect(total?.program.code).toContain("vec2i(runtime_fragment.position)");
	});

	it("is made of frame values: the sizes are computed from what's linked", () => {
		const model = simulation(
			"scale",
			undefined,
			{},
			{
				nodes: [
					{ id: "t", type: "time" },
					{ id: "k", type: "declare", data: { values: { x: 0.5 } } },
					{ id: "half", type: "mul" },
				],
				edges: [
					["t", "seconds", "half", "operands"],
					["k", "value", "half", "operands"],
					["half", "result", "s_in", "scale:acc"],
				],
			},
		);
		const plan = generateRenderPlan(model);
		const size = stateOf(plan, stateId("acc"))?.size;
		expect(size?.kind === "scale" && typeof size.scale).toBe("object");
		if (size?.kind !== "scale") return;
		const values = evaluateFrame(plan.frame, {
			time: 4,
			delta: 0,
			frame: 0,
			canvas: { width: 640, height: 360 },
			passSize: { width: 640, height: 360 },
		});
		expect(values.arg(size.scale)).toBe(2);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("refuse a value computed per pixel", () => {
		const model = simulation(
			"scale",
			undefined,
			{},
			{
				nodes: [
					{ id: "uv", type: "uv" },
					{ id: "x", type: "separate-vector" },
				],
				edges: [
					["uv", "uv", "x", "v"],
					["x", "x", "s_in", "scale:acc"],
				],
			},
		);
		const into = model.root.edges.find((e) => e.targetHandle === "scale:acc");
		expect(into && model.frameValueAnalysis().link([], into)?.kind).toBe("invalid");
	});

	it("scale a texture they're like, which the plan has before their passes", () => {
		const model = simulation(
			"scale",
			undefined,
			{ values: { "scale:acc": 0.25 } },
			{
				nodes: [{ id: "img", type: "image", data: { asset: "a" } }],
				edges: [["img", "texture", "s_in", "like:acc"]],
			},
		);
		const plan = generateRenderPlan(model);
		const size = stateOf(plan, stateId("acc"))?.size;
		expect(size).toEqual({ kind: "scale", scale: 0.25, of: { resource: "media:a" } });
		expect(plan.resources.some((r) => r.id === "media:a")).toBe(true);
		const step = planPasses(plan.passes).find((p) => p.writes.includes(stateId("acc")));
		expect(planPasses(plan.passes).findIndex((p) => p === step)).toBeGreaterThanOrEqual(0);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("scale the canvas without a texture to be like", () => {
		const plan = generateRenderPlan(
			simulation("scale", undefined, { values: { "scale:acc": 2 } }),
		);
		expect(stateOf(plan, stateId("acc"))?.size).toEqual({
			kind: "scale",
			scale: 2,
			of: "canvas",
		});
	});

	it("keep a texture the frame samples, from a pass at its size", () => {
		const model = managerFor(
			[
				{
					id: "s_in",
					type: "simulation-input",
					data: { pairedOutput: "s_out", values: { "scale:img": 0.5 } },
				},
				{
					id: "s_out",
					type: "simulation-output",
					data: {
						items: [{ id: "img", label: "Image", type: "texture", size: "scale" }],
					},
				},
				{ id: "uv", type: "uv" },
				{ id: "view", type: "sample-texture" },
			],
			[
				["uv", "uv", "s_out", "img"],
				["s_out", "img", "view", "texture"],
				["view", "color", "out", "color"],
			],
		);
		const plan = generateRenderPlan(model);
		expect(stateOf(plan, stateId("img"))?.size).toEqual({
			kind: "scale",
			scale: 0.5,
			of: "canvas",
		});
		const frame = planPasses(plan.passes).find((p) => p.writes.includes(PLAN_TARGET));
		expect(frame?.program.code).toContain("textureSampleLevel");
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("are set on a simulation's items only, with the inputs their mode has", () => {
		const model = managerFor([], []);
		const zone = model.createSimulationZone({ x: 0, y: 0 }) ?? "";
		const item = model.getZoneItems(zone)[0]?.id ?? "";
		const inputs = () =>
			model
				.resolveDescriptor(model.resolveNode(zone) ?? ({} as never))
				.inputs.map((i) => i.id);
		expect(inputs()).toEqual([item]);
		model.setZoneItemSize(zone, item, "scale");
		expect(inputs()).toEqual([item, `scale:${item}`, `like:${item}`]);
		model.setZoneItemSize(zone, item, "pixels");
		expect(inputs()).toEqual([item, `pixels:${item}`]);
		model.setZoneItemSize(zone, item, undefined);
		expect(inputs()).toEqual([item]);
		expect(model.getZoneItems(zone)[0]).not.toHaveProperty("size");
		const repeat = model.createRepeatZone({ x: 0, y: 0 }) ?? "";
		const repeated = model.getZoneItems(repeat)[0]?.id ?? "";
		model.setZoneItemSize(repeat, repeated, "scale");
		expect(model.getZoneItems(repeat)[0]).not.toHaveProperty("size");
	});

	it("drop the links to inputs a mode no longer has", () => {
		const model = simulation(
			"scale",
			undefined,
			{},
			{
				nodes: [{ id: "k", type: "declare", data: { values: { x: 2 } } }],
				edges: [["k", "value", "s_in", "scale:acc"]],
			},
		);
		const links = () => model.root.edges.filter((e) => e.targetHandle === "scale:acc").length;
		expect(links()).toBe(1);
		model.setZoneItemSize("s_in", "acc", "pixels");
		expect(links()).toBe(0);
	});
});

describe("simulation state read as the previous frame's", () => {
	it("is stepped every frame, though nothing reads its current state", () => {
		// The frame draws `total`, which reads `acc`'s previous value.
		const model = managerFor(
			[
				{ id: "s_in", type: "simulation-input", data: { pairedOutput: "s_out" } },
				{
					id: "s_out",
					type: "simulation-output",
					data: { items: [f32("acc"), f32("total")] },
				},
				{ id: "grow", type: "add" },
				{ id: "sum", type: "add" },
			],
			[
				["s_in", "acc", "grow", "operands"],
				["s_in", "delta-time", "grow", "operands"],
				["grow", "result", "s_out", "acc"],
				["s_in", "total", "sum", "operands"],
				["s_in", "acc", "sum", "operands"],
				["sum", "result", "s_out", "total"],
				["s_out", "total", "out", "color"],
			],
		);
		const plan = generateRenderPlan(model);
		const writes = planPasses(plan.passes)
			.filter((p) => p.simulation?.stage === "step")
			.flatMap((p) => p.writes);
		expect(writes).toContain(stateId("acc"));
		expect(writes).toContain(stateId("total"));
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("is stepped for a texture too", () => {
		const model = managerFor(
			[
				{ id: "s_in", type: "simulation-input", data: { pairedOutput: "s_out" } },
				{
					id: "s_out",
					type: "simulation-output",
					data: { items: [{ id: "img", label: "Image", type: "texture" }, f32("n")] },
				},
				{ id: "uv", type: "uv" },
				{ id: "look", type: "sample-texture" },
			],
			[
				["uv", "uv", "s_out", "img"],
				["s_in", "img", "look", "texture"],
				["look", "color", "s_out", "n"],
				["s_out", "n", "out", "color"],
			],
		);
		const plan = generateRenderPlan(model);
		const writes = planPasses(plan.passes)
			.filter((p) => p.simulation?.stage === "step")
			.flatMap((p) => p.writes);
		expect(writes).toContain(stateId("img"));
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});
});
