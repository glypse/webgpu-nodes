import { describe, expect, it } from "vitest";

import { analyzeZones, wouldCreateCycle } from ".";
import { generateShader } from "../codegen";
import { ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, rootProject, shaderFor, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { HandleDef, NodeData } from "../types";

/** A repeat zone `<id>_in` / `<id>_out` with the given state items. */
function zone(id: string, items: HandleDef[], inputData: NodeData = {}): TestNode[] {
	return [
		{
			id: `${id}_in`,
			type: "repeat-input",
			data: { pairedOutput: `${id}_out`, values: { iterations: 3 }, ...inputData },
		},
		{ id: `${id}_out`, type: "repeat-output", data: { items } },
	];
}

const ACC: HandleDef = { id: "acc", label: "Accumulator", type: "f32" };

function analyze(nodes: TestNode[], edges: TestEdge[]) {
	const doc = rootProject(nodes, edges).definitions[ROOT_ID];
	if (!doc) throw new Error("missing root");
	return analyzeZones(doc.nodes, doc.edges);
}

function expectValid(shader: string) {
	if (!nagaBin) return;
	const error = validateFragment(shader);
	expect(error, `${error ?? ""}\n\n${shader}`).toBeNull();
}

/** acc = acc + iteration, starting from 1, output as the red channel. */
const accumulate = {
	nodes: [
		...zone("z", [ACC]),
		{ id: "init", type: "declare", data: { values: { x: 1 } } },
		{ id: "body", type: "add" },
	] satisfies TestNode[],
	edges: [
		["init", "value", "z_in", "acc"],
		["z_in", "acc", "body", "operands"],
		["z_in", "iteration", "body", "operands"],
		["body", "result", "z_out", "acc"],
		["z_out", "acc", "out", "color"],
	] satisfies TestEdge[],
};

describe("analyzeZones", () => {
	it("puts nodes downstream of the zone input inside the zone", () => {
		const analysis = analyze(accumulate.nodes, accumulate.edges);
		expect(analysis.zones.get("z_in")?.outputId).toBe("z_out");
		expect(analysis.nodeZone.get("body")).toBe("z_in");
		expect(analysis.nodeZone.get("init")).toBeNull();
		expect(analysis.nodeZone.get("out")).toBeNull();
		expect([...(analysis.zones.get("z_in")?.members ?? [])]).toEqual(["body"]);
		expect(analysis.invalidEdges.size).toBe(0);
	});

	it("keeps loop invariants outside", () => {
		const analysis = analyze(
			[...accumulate.nodes, { id: "t", type: "time" }, { id: "k", type: "mul" }],
			[
				...accumulate.edges,
				["t", "time", "k", "operands"],
				["k", "result", "body", "operands"],
			],
		);
		expect(analysis.nodeZone.get("k")).toBeNull();
		expect(analysis.nodeZone.get("body")).toBe("z_in");
	});

	it("counts dead-end branches as inside", () => {
		const analysis = analyze(
			[...accumulate.nodes, { id: "dead", type: "sin" }],
			[...accumulate.edges, ["z_in", "acc", "dead", "e"]],
		);
		expect(analysis.nodeZone.get("dead")).toBe("z_in");
	});

	it("invalidates links leaving a zone into a sink", () => {
		const analysis = analyze(accumulate.nodes, [
			...accumulate.edges.filter((e) => e[2] !== "out"),
			["body", "result", "out", "color"],
		]);
		expect(analysis.invalidEdges).toContain("body.result->out.color");
	});

	it("invalidates the inside link of a node both inside and after a zone", () => {
		const analysis = analyze(
			[...accumulate.nodes, { id: "mix", type: "add" }],
			[
				...accumulate.edges.filter((e) => e[2] !== "out"),
				["body", "result", "mix", "operands"],
				["z_out", "acc", "mix", "operands"],
				["mix", "result", "out", "color"],
			],
		);
		expect([...analysis.invalidEdges]).toEqual(["body.result->mix.operands"]);
		expect(analysis.nodeZone.get("mix")).toBeNull();
	});

	it("invalidates links merging two unrelated zones", () => {
		const analysis = analyze(
			[...zone("a", [ACC]), ...zone("b", [ACC]), { id: "both", type: "add" }],
			[
				["a_in", "acc", "a_out", "acc"],
				["b_in", "acc", "b_out", "acc"],
				["a_in", "acc", "both", "operands"],
				["b_in", "acc", "both", "operands"],
			],
		);
		expect(analysis.invalidEdges.size).toBe(1);
		expect(analysis.nodeZone.get("both")).not.toBeNull();
	});

	it("nests a zone whose output depends on another zone's body", () => {
		// Blender semantics: zone "a" must run once per iteration of "b".
		const analysis = analyze(
			[...zone("a", [ACC]), ...zone("b", [ACC]), { id: "both", type: "add" }],
			[
				["a_in", "acc", "both", "operands"],
				["b_in", "acc", "both", "operands"],
				["both", "result", "a_out", "acc"],
				["a_out", "acc", "b_out", "acc"],
			],
		);
		expect(analysis.zones.get("a_in")?.parent).toBe("b_in");
		expect(analysis.invalidEdges.size).toBe(0);
	});

	it("nests zones fed from another zone's body", () => {
		const analysis = analyze(
			[...zone("outer", [ACC]), ...zone("inner", [ACC])],
			[
				["outer_in", "acc", "inner_in", "acc"],
				["inner_out", "acc", "outer_out", "acc"],
			],
		);
		expect(analysis.zones.get("inner_in")?.parent).toBe("outer_in");
		expect(analysis.zones.get("inner_in")?.depth).toBe(1);
		expect(analysis.zones.get("outer_in")?.members).toContain("inner_out");
		expect(analysis.invalidEdges.size).toBe(0);
	});

	it("flags unpaired zone nodes", () => {
		const analysis = analyze(
			[{ id: "lonely", type: "repeat-output", data: { items: [ACC] } }],
			[["lonely", "acc", "out", "color"]],
		);
		expect(analysis.unpaired).toContain("lonely");
		expect(analysis.invalidEdges.size).toBe(1);
	});

	it("detects cycles through the implicit input → output link", () => {
		const doc = rootProject(accumulate.nodes, accumulate.edges).definitions[ROOT_ID];
		if (!doc) throw new Error("missing root");
		expect(wouldCreateCycle(doc.nodes, doc.edges, "z_out", "z_in")).toBe(true);
		expect(wouldCreateCycle(doc.nodes, doc.edges, "init", "body")).toBe(false);
	});
});

describe("repeat zone codegen", () => {
	it("emits a clamped loop with state variables", () => {
		const shader = shaderFor(accumulate.nodes, accumulate.edges);
		expect(shader).toContain("var z_z_in_s0: f32 = v_init;");
		expect(shader).toContain("let z_z_in_n = clamp(i32(3), 0, 1024);");
		expect(shader).toContain("for (var z_z_in_i: i32 = 0; z_z_in_i < z_z_in_n; z_z_in_i++) {");
		expect(shader).toContain("z_z_in_s0 = z_z_in_next0;");
		expectValid(shader);
	});

	it("hoists loop invariants before the loop", () => {
		const shader = shaderFor(
			[...accumulate.nodes, { id: "t", type: "time" }, { id: "k", type: "mul" }],
			[
				...accumulate.edges,
				["t", "time", "k", "operands"],
				["k", "result", "body", "operands"],
			],
		);
		expect(shader.indexOf("let v_k")).toBeLessThan(shader.indexOf("for ("));
		expect(shader.indexOf("let v_body")).toBeGreaterThan(shader.indexOf("for ("));
		expectValid(shader);
	});

	it("drives the iteration count from any value, with a custom cap", () => {
		const shader = shaderFor(
			[...zone("z", [ACC], { maxIterations: 64 }), { id: "t", type: "time" }],
			[
				["t", "time", "z_in", "iterations"],
				["z_in", "acc", "z_out", "acc"],
				["z_out", "acc", "out", "color"],
			],
		);
		expect(shader).toContain("clamp(i32(v_t), 0, 64)");
		expectValid(shader);
	});

	it("swaps state items safely (next values computed before assignment)", () => {
		const a: HandleDef = { id: "a", label: "a", type: "vec2f" };
		const b: HandleDef = { id: "b", label: "b", type: "vec2f" };
		const shader = shaderFor(
			[...zone("z", [a, b]), { id: "uv", type: "uv" }, { id: "sum", type: "add" }],
			[
				["uv", "uv", "z_in", "a"],
				["z_in", "a", "z_out", "b"],
				["z_in", "b", "z_out", "a"],
				["z_out", "a", "sum", "operands"],
				["z_out", "b", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		const swap = shader.slice(shader.indexOf("let z_z_in_next0"));
		expect(swap.indexOf("let z_z_in_next1")).toBeLessThan(swap.indexOf("z_z_in_s0 ="));
		expectValid(shader);
	});

	it("supports nested zones and every value kind", () => {
		const items: HandleDef[] = [
			{ id: "f", label: "f", type: "vec3f" },
			{ id: "i", label: "i", type: "i32" },
			{ id: "u", label: "u", type: "vec2u" },
			{ id: "b", label: "b", type: "bool" },
		];
		const shader = shaderFor(
			[
				...zone("outer", items),
				...zone("inner", items),
				{ id: "inc", type: "add" },
				{ id: "flip", type: "not" },
				{ id: "final", type: "switch" },
			],
			[
				...items.map((item): TestEdge => ["outer_in", item.id, "inner_in", item.id]),
				["inner_in", "i", "inc", "operands"],
				["outer_in", "iteration", "inc", "operands"],
				["inner_in", "iteration", "inc", "operands"],
				["inc", "result", "inner_out", "i"],
				["inner_in", "b", "flip", "e"],
				["flip", "result", "inner_out", "b"],
				["inner_in", "f", "inner_out", "f"],
				["inner_in", "u", "inner_out", "u"],
				...items.map((item): TestEdge => ["inner_out", item.id, "outer_out", item.id]),
				["outer_out", "b", "final", "condition"],
				["outer_out", "f", "final", "true"],
				["final", "result", "out", "color"],
			],
		);
		const outerLoop = shader.indexOf("for (var z_outer_in_i");
		const innerLoop = shader.indexOf("for (var z_inner_in_i");
		expect(outerLoop).toBeGreaterThan(-1);
		expect(innerLoop).toBeGreaterThan(outerLoop);
		expectValid(shader);
	});

	it("runs a zone depending on another zone's body inside that zone's loop", () => {
		const shader = shaderFor(
			[...zone("a", [ACC]), ...zone("b", [ACC]), { id: "both", type: "add" }],
			[
				["a_in", "acc", "both", "operands"],
				["b_in", "acc", "both", "operands"],
				["both", "result", "a_out", "acc"],
				["a_out", "acc", "b_out", "acc"],
				["b_out", "acc", "out", "color"],
			],
		);
		expect(shader.indexOf("for (var z_a_in_i")).toBeGreaterThan(
			shader.indexOf("for (var z_b_in_i"),
		);
		expectValid(shader);
	});

	it("treats invalid links as disconnected", () => {
		const shader = shaderFor(accumulate.nodes, [
			...accumulate.edges.filter((e) => e[2] !== "out"),
			["body", "result", "out", "color"],
		]);
		expect(shader).not.toContain("for (");
		expectValid(shader);
	});

	it("works inside node groups", () => {
		const project = rootProject(
			[{ id: "g", type: "node-group", group: { definitionRef: "def", locked: false } }],
			[["g", "res", "out", "color"]],
		);
		project.definitions.def = {
			label: "Looping group",
			nodes: [
				{
					id: "gi",
					type: "group-input",
					data: { handles: [{ id: "seed", label: "seed", type: "f32" }] },
					position: { x: 0, y: 0 },
				},
				{
					id: "go",
					type: "group-output",
					data: { handles: [{ id: "res", label: "res", type: "vec4f" }] },
					position: { x: 0, y: 0 },
				},
				...zone("gz", [ACC]).map((n) => ({
					...n,
					data: n.data ?? {},
					position: { x: 0, y: 0 },
				})),
				{ id: "gsin", type: "sin", data: {}, position: { x: 0, y: 0 } },
			],
			edges: [
				edge(["gi", "seed", "gz_in", "acc"]),
				edge(["gz_in", "acc", "gsin", "e"]),
				edge(["gsin", "result", "gz_out", "acc"]),
				edge(["gz_out", "acc", "go", "res"]),
			],
		};
		const shader = generateShader(new GraphModel(project)).shader;
		expect(shader).toContain("for (var z_gz_in_i");
		expectValid(shader);
	});
});
