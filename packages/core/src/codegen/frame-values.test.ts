import { describe, expect, it } from "bun:test";

import { generateRenderPlan } from ".";
import { evaluateFrame, type FrameEnv } from "../frame/program";
import { ROOT_ID } from "../graph/document";
import { managerFor, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";

const ENV: FrameEnv = {
	time: 0,
	delta: 0,
	frame: 0,
	canvas: { width: 640, height: 360 },
	passSize: { width: 640, height: 360 },
};

/** `sin(time * 3)` drawn as the colour. */
const pulse: TestNode[] = [
	{ id: "time", type: "time" },
	{ id: "k", type: "declare", data: { values: { x: 3 } } },
	{ id: "scaled", type: "mul" },
	{ id: "wave", type: "sin" },
];
const pulseEdges: TestEdge[] = [
	["time", "seconds", "scaled", "operands"],
	["k", "value", "scaled", "operands"],
	["scaled", "result", "wave", "e"],
	["wave", "result", "out", "color"],
];

describe("hoisted frame values", () => {
	it("are read from the frame block instead of computed per pixel", () => {
		const plan = generateRenderPlan(managerFor(pulse, pulseEdges));
		const [pass] = plan.passes;
		expect(pass?.program.code).not.toContain("sin(");
		expect(pass?.program.code).not.toContain("runtime_frame.time");
		expect(pass?.program.code).toContain("runtime_frame_values.f_wave_result");
		expect(Object.keys(pass?.program.frameValues.fields ?? {})).toEqual(["f_wave_result"]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("are what the CPU computes for the formula, at any time", () => {
		const plan = generateRenderPlan(managerFor(pulse, pulseEdges));
		const field = plan.passes[0]?.program.frameValues.fields.f_wave_result;
		for (const time of [0, 0.4, 1.7, 9]) {
			const values = evaluateFrame(plan.frame, { ...ENV, time });
			const [value] = field ? values.ref(field.ref) : [];
			expect(value).toBeCloseTo(Math.sin(time * 3), 5);
		}
	});

	it("read uniforms where inputs are, so editing a value only changes them", () => {
		const graph = managerFor(pulse, pulseEdges);
		const before = generateRenderPlan(graph, { uniformScopes: [ROOT_ID] });
		graph.setInputValue("k", "x", 5);
		const after = generateRenderPlan(graph, { uniformScopes: [ROOT_ID] });
		expect(after.passes[0]?.program.code).toBe(before.passes[0]?.program.code);
		expect(before.uniforms).toMatchObject({ u_k_x: 3 });
		expect(after.uniforms).toMatchObject({ u_k_x: 5 });
		const field = after.passes[0]?.program.frameValues.fields.f_wave_result;
		const values = evaluateFrame(after.frame, { ...ENV, time: 2, uniforms: after.uniforms });
		expect(field && values.ref(field.ref)[0]).toBeCloseTo(Math.sin(10), 5);
		if (nagaBin) expect(validatePlan(after)).toEqual([]);
	});

	it("leave per-pixel values and what only they read in the shader", () => {
		const nodes: TestNode[] = [
			...pulse,
			{ id: "uv", type: "uv" },
			{ id: "x", type: "separate-vector" },
			{ id: "sum", type: "add" },
		];
		const plan = generateRenderPlan(
			managerFor(nodes, [
				...pulseEdges.slice(0, 3),
				["uv", "uv", "x", "v"],
				["x", "x", "sum", "operands"],
				["wave", "result", "sum", "operands"],
				["sum", "result", "out", "color"],
			]),
		);
		const code = plan.passes[0]?.program.code ?? "";
		expect(code).toContain("runtime_frame_values.f_wave_result");
		expect(code).toContain("runtime_fragment.uv");
		expect(code).not.toContain("sin(");
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("keep values of literals only in the shader, for the compiler to fold", () => {
		const plan = generateRenderPlan(
			managerFor(
				[{ id: "wave", type: "sin", data: { values: { e: 2 } } }],
				[["wave", "result", "out", "color"]],
			),
		);
		expect(plan.passes[0]?.program.code).toContain("sin(");
		expect(plan.passes[0]?.program.frameValues.fields).toEqual({});
		expect(plan.frame.steps).toHaveLength(0);
	});

	it("store integers and booleans as integers", () => {
		const nodes: TestNode[] = [
			{ id: "time", type: "time" },
			{ id: "n", type: "to-int" },
			{ id: "big", type: "compare", data: { settings: { op: ">" }, values: { b: 1 } } },
			{ id: "uv", type: "uv" },
			{ id: "x", type: "separate-vector" },
			{ id: "pick", type: "switch" },
			{ id: "scaled", type: "mul" },
		];
		const plan = generateRenderPlan(
			managerFor(nodes, [
				["time", "seconds", "n", "e"],
				["n", "result", "big", "a"],
				["uv", "uv", "x", "v"],
				["big", "result", "pick", "condition"],
				["x", "x", "pick", "true"],
				["n", "result", "scaled", "operands"],
				["pick", "result", "scaled", "operands"],
				["scaled", "result", "out", "color"],
			]),
		);
		const [pass] = plan.passes;
		const field = (name: string) => pass?.program.frameValues.fields[name];
		expect(field("f_n_result")?.scalar).toBe("i32");
		expect(field("f_big_result")?.scalar).toBe("u32");
		const values = evaluateFrame(plan.frame, { ...ENV, time: 2.7 });
		expect(values.ref(field("f_n_result")?.ref ?? { step: 0, output: "" })).toEqual([2]);
		expect(values.ref(field("f_big_result")?.ref ?? { step: 0, output: "" })).toEqual([1]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});
});
