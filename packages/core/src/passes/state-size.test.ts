import { describe, expect, it } from "bun:test";

import { generateRenderPlan, PLAN_TARGET } from "../codegen";
import type { GraphModel } from "../graph/model";
import { managerFor } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";
import type { ItemSize, ZoneItem } from "../types";
import { itemSizes, stateReadId, stateTextureId } from "./simulation";
import { CANVAS_SIZE } from "./textures";

const ref = { path: [], zone: "s_in" };
const stateId = (item: string) => stateReadId(stateTextureId(ref, item), "current");

const f32 = (id: string, size?: ItemSize): ZoneItem => ({
	id,
	label: id,
	type: "f32",
	...(size ? { size } : {}),
});

/** A simulation `acc += delta`, and `total += acc`, drawn as the frame as their sum. */
function simulation(acc?: ItemSize, total?: ItemSize): GraphModel {
	return managerFor(
		[
			{
				id: "s_in",
				type: "simulation-input",
				data: { pairedOutput: "s_out", values: { acc: 0, total: 0 } },
			},
			{
				id: "s_out",
				type: "simulation-output",
				data: { items: [f32("acc", acc), f32("total", total)] },
			},
			{ id: "grow", type: "add" },
			{ id: "sum", type: "add" },
			{ id: "both", type: "add" },
		],
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
		],
	);
}

describe("sized simulation items", () => {
	it("are canvas-sized unless set", () => {
		const plan = generateRenderPlan(simulation());
		const states = plan.resources.filter((r) => r.kind === "state");
		expect(states.length).toBeGreaterThan(0);
		for (const state of states) expect(state.size).toEqual(CANVAS_SIZE);
	});

	it("are drawn at their own size, an item of another size in a pass of its own", () => {
		const model = simulation({ kind: "pixels", width: 1024, height: 1 });
		const plan = generateRenderPlan(model);
		const acc = plan.resources.find((r) => r.id === stateId("acc"));
		expect(acc?.kind === "state" && acc.size).toEqual({
			kind: "pixels",
			width: 1024,
			height: 1,
		});
		const steps = plan.passes.filter((p) => p.simulation?.stage === "step");
		expect(steps.map((p) => p.writes)).toEqual([[stateId("acc")], [stateId("total")]]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("is read by a canvas-sized pass at the nearest texel", () => {
		const model = simulation({ kind: "pixels", width: 1024, height: 1 });
		const plan = generateRenderPlan(model);
		const total = plan.passes.find((p) => p.writes.includes(stateId("total")));
		const code = total?.program.code ?? "";
		expect(code).toContain("textureDimensions");
		// The canvas-sized pass reads its own item at the pixel.
		expect(code).toContain("vec2i(runtime_fragment.position)");
	});

	it("scales from another item, whose size the plan declares", () => {
		const model = simulation(
			{ kind: "pixels", width: 64, height: 32 },
			{ kind: "scale", scale: 0.5, of: "acc" },
		);
		const plan = generateRenderPlan(model);
		const total = plan.resources.find((r) => r.id === stateId("total"));
		expect(total?.kind === "state" && total.size).toEqual({
			kind: "scale",
			scale: 0.5,
			of: { resource: stateId("acc") },
		});
		expect(plan.resources.some((r) => r.id === stateId("acc"))).toBe(true);
		expect(plan.passes.at(-1)?.writes).toEqual([PLAN_TARGET]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("keeps a texture the frame samples, from a pass at its size", () => {
		const size: ItemSize = { kind: "scale", scale: 0.5 };
		const model = managerFor(
			[
				{
					id: "s_in",
					type: "simulation-input",
					data: { pairedOutput: "s_out" },
				},
				{
					id: "s_out",
					type: "simulation-output",
					data: { items: [{ id: "img", label: "Image", type: "texture", size }] },
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
		const image = plan.resources.find(
			(r) => r.id === stateReadId(stateTextureId(ref, "img"), "current"),
		);
		expect(image?.kind === "state" && image.size).toEqual({
			kind: "scale",
			scale: 0.5,
			of: "canvas",
		});
		const frame = plan.passes.find((p) => p.writes.includes(PLAN_TARGET));
		expect(frame?.program.code).toContain("textureSampleLevel");
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("scale from the canvas when the item they're scaled from is the canvas'", () => {
		const sizes = itemSizes(ref, [f32("a"), f32("b", { kind: "scale", scale: 2, of: "a" })]);
		expect(sizes.get("b")).toEqual({ kind: "scale", scale: 2, of: "canvas" });
	});

	it("can't be sized in a loop", () => {
		const model = simulation(undefined, { kind: "scale", scale: 2, of: "acc" });
		expect(model.setZoneItemSize("s_in", "acc", { kind: "scale", scale: 2, of: "total" })).toBe(
			false,
		);
		expect(model.setZoneItemSize("s_in", "acc", { kind: "scale", scale: 2, of: "acc" })).toBe(
			false,
		);
		expect(model.setZoneItemSize("s_in", "acc", { kind: "scale", scale: 2, of: "gone" })).toBe(
			false,
		);
		// Stored loops (from a file) still resolve to something.
		const sizes = itemSizes(ref, [
			f32("a", { kind: "scale", scale: 2, of: "b" }),
			f32("b", { kind: "scale", scale: 3, of: "a" }),
		]);
		expect(sizes.get("a")).toEqual({ kind: "scale", scale: 2, of: { resource: stateId("b") } });
		expect(sizes.get("b")).toEqual({ kind: "scale", scale: 3, of: "canvas" });
	});

	it("are set on a simulation's items only", () => {
		const model = managerFor([], []);
		const zone = model.createSimulationZone({ x: 0, y: 0 }) ?? "";
		const item = model.getZoneItems(zone)[0]?.id ?? "";
		const size: ItemSize = { kind: "pixels", width: 1024, height: 1 };
		expect(model.setZoneItemSize(zone, item, size)).toBe(true);
		expect(model.getZoneItems(zone)[0]?.size).toEqual(size);
		model.setZoneItemSize(zone, item, undefined);
		expect(model.getZoneItems(zone)[0]).not.toHaveProperty("size");
		const repeat = model.createRepeatZone({ x: 0, y: 0 }) ?? "";
		const repeated = model.getZoneItems(repeat)[0]?.id ?? "";
		expect(model.setZoneItemSize(repeat, repeated, size)).toBe(false);
	});
});
