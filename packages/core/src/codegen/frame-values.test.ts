import { describe, expect, it } from "bun:test";

import { generateRenderPlan, planPasses } from ".";
import { evaluateFrame, type FrameEnv } from "../frame/program";
import { type GraphProject, ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, managerFor, rootProject, type TestEdge, type TestNode } from "../testing/graph";
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
		const [pass] = planPasses(plan.passes);
		expect(pass?.program.code).not.toContain("sin(");
		expect(pass?.program.code).not.toContain("runtime_frame.time");
		expect(pass?.program.code).toContain("runtime_frame_values.f_wave_result");
		expect(Object.keys(pass?.program.frameValues.fields ?? {})).toEqual(["f_wave_result"]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("are what the CPU computes for the formula, at any time", () => {
		const plan = generateRenderPlan(managerFor(pulse, pulseEdges));
		const field = planPasses(plan.passes)[0]?.program.frameValues.fields.f_wave_result;
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
		expect(planPasses(after.passes)[0]?.program.code).toBe(
			planPasses(before.passes)[0]?.program.code,
		);
		expect(before.uniforms).toMatchObject({ u_k_x: 3 });
		expect(after.uniforms).toMatchObject({ u_k_x: 5 });
		const field = planPasses(after.passes)[0]?.program.frameValues.fields.f_wave_result;
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
		const code = planPasses(plan.passes)[0]?.program.code ?? "";
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
		expect(planPasses(plan.passes)[0]?.program.code).toContain("sin(");
		expect(planPasses(plan.passes)[0]?.program.frameValues.fields).toEqual({});
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
		const [pass] = planPasses(plan.passes);
		const field = (name: string) => pass?.program.frameValues.fields[name];
		expect(field("f_n_result")?.scalar).toBe("i32");
		expect(field("f_big_result")?.scalar).toBe("u32");
		const values = evaluateFrame(plan.frame, { ...ENV, time: 2.7 });
		expect(values.ref(field("f_n_result")?.ref ?? { step: 0, output: "" })).toEqual([2]);
		expect(values.ref(field("f_big_result")?.ref ?? { step: 0, output: "" })).toEqual([1]);
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});
});

describe("hoisted frame values in groups", () => {
	const at = { x: 0, y: 0 };
	type Definition = GraphProject["definitions"][string];

	/** `sin(time * 3) + u`, with `u` per pixel. */
	const pulsing: Definition = {
		inputs: [{ id: "u", label: "U", type: "f32" }],
		outputs: [{ id: "r", label: "R", type: "f32" }],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{ id: "time", type: "time", data: {}, position: at },
			{ id: "k", type: "declare", data: { values: { x: 3 } }, position: at },
			{ id: "scaled", type: "mul", data: {}, position: at },
			{ id: "wave", type: "sin", data: {}, position: at },
			{ id: "sum", type: "add", data: {}, position: at },
			{ id: "gout", type: "group-output", data: {}, position: at },
		],
		edges: [
			edge(["time", "seconds", "scaled", "operands"]),
			edge(["k", "value", "scaled", "operands"]),
			edge(["scaled", "result", "wave", "e"]),
			edge(["wave", "result", "sum", "operands"]),
			edge(["gin", "u", "sum", "operands"]),
			edge(["sum", "result", "gout", "r"]),
		],
	};
	/** `u + 1`: nothing for the frame. */
	const plain: Definition = {
		inputs: [{ id: "u", label: "U", type: "f32" }],
		outputs: [{ id: "r", label: "R", type: "f32" }],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{ id: "one", type: "declare", data: { values: { x: 1 } }, position: at },
			{ id: "sum", type: "add", data: {}, position: at },
			{ id: "gout", type: "group-output", data: {}, position: at },
		],
		edges: [
			edge(["gin", "u", "sum", "operands"]),
			edge(["one", "value", "sum", "operands"]),
			edge(["sum", "result", "gout", "r"]),
		],
	};

	const instance = (id: string, ref: string): TestNode => ({
		id,
		type: "node-group",
		group: { definitionRef: ref, locked: false },
	});

	function model(nodes: TestNode[], edges: TestEdge[]): GraphModel {
		const project = rootProject(nodes, edges);
		return new GraphModel({
			definitions: { ...project.definitions, pulsing, plain },
		});
	}

	/** Two instances fed per pixel, their results added. */
	const twice = (ref: string) =>
		model(
			[
				{ id: "uv", type: "uv" },
				{ id: "x", type: "separate-vector" },
				instance("g1", ref),
				instance("g2", ref),
				{ id: "sum", type: "add" },
			],
			[
				["uv", "uv", "x", "v"],
				["x", "x", "g1", "u"],
				["x", "x", "g2", "u"],
				["g1", "r", "sum", "operands"],
				["g2", "r", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);

	it("are read from fields of the instance, so each has a function of its own", () => {
		const plan = generateRenderPlan(twice("pulsing"));
		const [pass] = planPasses(plan.passes);
		const code = pass?.program.code ?? "";
		expect(code).not.toContain("sin(");
		expect(code).not.toContain("runtime_frame.time");
		const fields = Object.keys(pass?.program.frameValues.fields ?? {});
		expect(fields).toHaveLength(2);
		expect(fields.some((f) => f.includes("g1"))).toBe(true);
		expect(fields.some((f) => f.includes("g2"))).toBe(true);
		expect(code.match(/fn group_\w*pulsing\w*\(/g)).toHaveLength(2);
		for (const time of [0, 1.3]) {
			const values = evaluateFrame(plan.frame, { ...ENV, time });
			for (const name of fields) {
				const field = pass?.program.frameValues.fields[name];
				expect(field && values.ref(field.ref)[0]).toBeCloseTo(Math.sin(time * 3), 5);
			}
		}
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});

	it("leave instances of a group with none sharing one function", () => {
		const plan = generateRenderPlan(twice("plain"));
		const code = planPasses(plan.passes)[0]?.program.code ?? "";
		expect(code.match(/fn group_\w*plain\w*\(/g)).toHaveLength(1);
		expect(planPasses(plan.passes)[0]?.program.frameValues.fields).toEqual({});
	});

	it("are not hoisted from an instance in a repeat zone", () => {
		const graph = model(
			[
				{
					id: "r_in",
					type: "repeat-input",
					data: { pairedOutput: "r_out", values: { iterations: 2 } },
				},
				{
					id: "r_out",
					type: "repeat-output",
					data: { items: [{ id: "acc", label: "Acc", type: "f32" }] },
				},
				instance("g", "pulsing"),
			],
			[
				["r_in", "acc", "g", "u"],
				["g", "r", "r_out", "acc"],
				["r_out", "acc", "out", "color"],
			],
		);
		const plan = generateRenderPlan(graph);
		const pass = planPasses(plan.passes)[0];
		expect(pass?.program.code).toContain("runtime_frame.time");
		expect(pass?.program.frameValues.fields).toEqual({});
		if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	});
});
