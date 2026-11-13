import { describe, expect, it } from "bun:test";

import { analyzeZones, simulatingDefinitions } from ".";
import {
	generateRenderPlan,
	PLAN_TARGET,
	type RenderPlan,
	SIMULATION_DELTA_FIELD,
} from "../codegen";
import { ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, managerFor, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";
import type { HandleDef, NodeData, ZoneItem } from "../types";

/** A simulation zone `<id>_in` / `<id>_out` with the given state items. */
export function simulation(id: string, items: ZoneItem[], inputData: NodeData = {}): TestNode[] {
	return [
		{
			id: `${id}_in`,
			type: "simulation-input",
			data: { pairedOutput: `${id}_out`, ...inputData },
		},
		{ id: `${id}_out`, type: "simulation-output", data: { items } },
	];
}

/** A repeat zone `<id>_in` / `<id>_out` with the given state items. */
function repeat(id: string, items: ZoneItem[]): TestNode[] {
	return [
		{
			id: `${id}_in`,
			type: "repeat-input",
			data: { pairedOutput: `${id}_out`, values: { iterations: 3 } },
		},
		{ id: `${id}_out`, type: "repeat-output", data: { items } },
	];
}

const ACC: HandleDef = { id: "acc", label: "Accumulator", type: "f32" };

function analyze(nodes: TestNode[], edges: TestEdge[], simulating?: ReadonlySet<string>) {
	const doc = rootProject(nodes, edges).definitions[ROOT_ID];
	if (!doc) throw new Error("missing root");
	return analyzeZones(doc.nodes, doc.edges, { simulating });
}

describe("simulation zone analysis", () => {
	it("pairs a simulation zone, its body inside it", () => {
		const analysis = analyze(
			[...simulation("s", [ACC]), { id: "body", type: "add" }],
			[
				["s_in", "acc", "body", "operands"],
				["s_in", "delta-time", "body", "operands"],
				["body", "result", "s_out", "acc"],
				["s_out", "acc", "out", "color"],
			],
		);
		expect(analysis.zones.get("s_in")?.kind).toBe("simulation");
		expect(analysis.nodeZone.get("body")).toBe("s_in");
		expect(analysis.invalidEdges.size).toBe(0);
	});

	it("doesn't pair a simulation input with a repeat output", () => {
		const analysis = analyze(
			[
				{ id: "s_in", type: "simulation-input", data: { pairedOutput: "r_out" } },
				{ id: "r_out", type: "repeat-output", data: { items: [ACC] } },
			],
			[],
		);
		expect(analysis.zones.size).toBe(0);
		expect([...analysis.unpaired].toSorted()).toEqual(["r_out", "s_in"]);
	});

	it("keeps a simulation out of a repeat zone", () => {
		const analysis = analyze(
			[...repeat("r", [ACC]), ...simulation("s", [ACC])],
			[
				["r_in", "acc", "s_in", "acc"],
				["s_out", "acc", "r_out", "acc"],
			],
		);
		expect(analysis.zones.get("s_in")?.parent).toBeNull();
		expect(analysis.invalidEdges.has("r_in.acc->s_in.acc")).toBe(true);
	});

	it("keeps a simulation out of another simulation", () => {
		const analysis = analyze(
			[...simulation("a", [ACC]), ...simulation("b", [ACC])],
			[
				["a_in", "acc", "b_in", "acc"],
				["b_out", "acc", "a_out", "acc"],
			],
		);
		expect(analysis.zones.get("b_in")?.parent).toBeNull();
		expect(analysis.invalidEdges.has("a_in.acc->b_in.acc")).toBe(true);
	});

	it("lets a repeat zone loop inside a simulation's step", () => {
		const analysis = analyze(
			[...simulation("s", [ACC]), ...repeat("r", [ACC])],
			[
				["s_in", "acc", "r_in", "acc"],
				["r_out", "acc", "s_out", "acc"],
			],
		);
		expect(analysis.zones.get("r_in")?.parent).toBe("s_in");
		expect(analysis.invalidEdges.size).toBe(0);
	});

	it("keeps groups computing a simulation out of zones", () => {
		const nodes: TestNode[] = [
			...repeat("r", [ACC]),
			{ id: "g", type: "node-group", group: { definitionRef: "sim", locked: false } },
		];
		const edges: TestEdge[] = [
			["r_in", "acc", "g", "x"],
			["g", "y", "r_out", "acc"],
		];
		expect(analyze(nodes, edges).invalidEdges.size).toBe(0);
		const analysis = analyze(nodes, edges, new Set(["sim"]));
		expect(analysis.nodeZone.get("g")).toBeNull();
		expect(analysis.invalidEdges.has("r_in.acc->g.x")).toBe(true);
	});
});

describe("simulatingDefinitions", () => {
	it("lists definitions simulating themselves or through the groups they nest", () => {
		const sim = { id: "s", type: "simulation-input", data: {} };
		const group = (ref: string) => ({
			id: `g-${ref}`,
			type: "node-group",
			data: {},
			group: { definitionRef: ref },
		});
		const definitions = new Map([
			["a", { nodes: [sim] }],
			["b", { nodes: [group("a")] }],
			["c", { nodes: [group("b")] }],
			["d", { nodes: [] }],
		]);
		expect([...simulatingDefinitions(definitions)].toSorted()).toEqual(["a", "b", "c"]);
	});
});

describe("simulation zone editing", () => {
	const model = () => managerFor([], []);

	it("creates a paired zone with one item passed through, and a Skip input", () => {
		const graph = model();
		const id = graph.createSimulationZone({ x: 0, y: 0 }) ?? "";
		expect(graph.zoneKind(id)).toBe("simulation");
		const input = graph.activeDocument.nodesById.get(id);
		const outputs = graph.resolveNodeOutputs(id).map((o) => o.label);
		expect(outputs).toEqual(["Delta Time", "Value"]);
		const output = graph.activeDocument.nodesById.get(input?.data.pairedOutput ?? "");
		expect(graph.resolveNodeInputs(output?.id ?? "").map((i) => i.label)).toEqual([
			"Skip",
			"Value",
		]);
		expect(graph.activeDocument.edges).toHaveLength(1);
	});

	it("carries textures, whose values are colours", () => {
		const graph = model();
		const id = graph.createSimulationZone({ x: 0, y: 0 }) ?? "";
		const item = graph.addZoneItem(id, "texture", "Image");
		expect(item?.type).toBe("texture");
		expect(graph.resolveInputType(id, item?.id ?? "")).toBe("vec4f");
		expect(graph.resolveOutputHandleType(id, item?.id ?? "")).toBe("texture");
	});

	it("doesn't let repeat zones carry textures", () => {
		const graph = model();
		const id = graph.createRepeatZone({ x: 0, y: 0 }) ?? "";
		expect(graph.addZoneItem(id, "texture")).toBeUndefined();
	});
});

function planFor(graph: GraphModel): RenderPlan {
	const plan = generateRenderPlan(graph);
	if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	return plan;
}

const VEC: HandleDef = { id: "vec", label: "Vector", type: "vec3f" };
const INT: HandleDef = { id: "int", label: "Count", type: "i32" };
const FLAG: HandleDef = { id: "flag", label: "Flag", type: "bool" };
const IMAGE: ZoneItem = { id: "img", label: "Image", type: "texture" };

/** acc += delta time each frame, from 1, drawn as grey. */
const counter = {
	nodes: [
		...simulation("s", [ACC]),
		{ id: "init", type: "declare", data: { values: { x: 1 } } },
		{ id: "body", type: "add" },
	] satisfies TestNode[],
	edges: [
		["init", "value", "s_in", "acc"],
		["s_in", "acc", "body", "operands"],
		["s_in", "delta-time", "body", "operands"],
		["body", "result", "s_out", "acc"],
		["s_out", "acc", "out", "color"],
	] satisfies TestEdge[],
};

describe("simulation zone codegen", () => {
	it("starts, steps, then reads a simulation's state", () => {
		const plan = planFor(managerFor(counter.nodes, counter.edges));
		const texture = "state:s_in:acc";
		expect(plan.passes.map((p) => [p.writes, p.simulation])).toEqual([
			[[`${texture}:previous`], { id: "s_in", stage: "start" }],
			[[`${texture}:current`], { id: "s_in", stage: "step" }],
			[[PLAN_TARGET], undefined],
		]);
		const [start, step, main] = plan.passes.map((p) => p.program);
		expect(start?.code).not.toContain("simulation_delta;");
		expect(step?.code).toContain(`runtime_frame.${SIMULATION_DELTA_FIELD}`);
		expect(step?.textures.map((t) => [t.source.id, t.sampleType])).toEqual([
			[`${texture}:previous`, "unfilterable-float"],
		]);
		// The frame reads the step's result, without computing the zone again.
		expect(main?.textures.map((t) => t.source.id)).toEqual([`${texture}:current`]);
		expect(main?.code).not.toContain(`runtime_frame.${SIMULATION_DELTA_FIELD}`);
		expect(plan.resources.find((r) => r.id === `${texture}:current`)).toMatchObject({
			kind: "state",
			texture,
			format: "r32float",
			simulation: "s_in",
		});
	});

	it("keeps the previous state where Skip is on", () => {
		const graph = managerFor(
			[...counter.nodes, { id: "t", type: "time" }, { id: "late", type: "compare" }],
			[...counter.edges, ["late", "result", "s_out", "skip"]],
		);
		const step = planFor(graph).passes.find((p) => p.simulation?.stage === "step");
		expect(step?.program.code).toMatch(/select\(.*, z_s_in_p0, z_s_in_skip\)/);
	});

	it("keeps every kind of value exactly, a pass writing at most 32 bytes per pixel", () => {
		const graph = managerFor(
			[
				...simulation("s", [
					ACC,
					VEC,
					INT,
					FLAG,
					{ ...ACC, id: "acc2" },
					{ ...VEC, id: "vec2" },
				]),
				{ id: "sum", type: "add" },
			],
			[
				["s_in", "vec", "s_out", "vec"],
				["s_in", "int", "s_out", "int"],
				["s_out", "vec", "sum", "operands"],
				["s_out", "vec2", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		const plan = planFor(graph);
		const steps = plan.passes.filter((p) => p.simulation?.stage === "step");
		// f32 4 + vec3f 16 + i32 4 + bool 4 + f32 4 | vec3f 16
		expect(steps.map((p) => p.writes.length)).toEqual([5, 1]);
		expect(steps[0]?.program.targets).toEqual(["vec4f", "vec4f", "vec4i", "vec4u", "vec4f"]);
		const formats = plan.resources.flatMap((r) => (r.kind === "state" ? [r.format] : []));
		expect(new Set(formats)).toEqual(
			new Set(["r32float", "rgba32float", "r32sint", "r32uint"]),
		);
	});

	it("keeps a texture of the previous frame, sampled anywhere", () => {
		const graph = managerFor(
			[
				...simulation("s", [IMAGE]),
				{ id: "uv", type: "uv" },
				{ id: "shift", type: "add" },
				{
					id: "by",
					type: "declare",
					data: { types: { declare: "vec2f" }, values: { x: 0.01 } },
				},
				{ id: "sample", type: "sample-texture" },
				{ id: "fade", type: "mul" },
				{ id: "k", type: "declare", data: { values: { x: 0.9 } } },
				{ id: "view", type: "sample-texture" },
			],
			[
				["uv", "uv", "s_in", "img"],
				["uv", "uv", "shift", "operands"],
				["by", "value", "shift", "operands"],
				["s_in", "img", "sample", "texture"],
				["shift", "result", "sample", "uv"],
				["sample", "color", "fade", "operands"],
				["k", "value", "fade", "operands"],
				["fade", "result", "s_out", "img"],
				["s_out", "img", "view", "texture"],
				["view", "color", "out", "color"],
			],
		);
		const plan = planFor(graph);
		const step = plan.passes.find((p) => p.simulation?.stage === "step");
		expect(step?.program.targets).toEqual(["vec4f"]);
		expect(step?.program.textures.map((t) => [t.source.id, t.sampleType])).toEqual([
			["state:s_in:img:previous", "float"],
		]);
		const main = plan.passes.at(-1);
		expect(main?.program.textures.map((t) => t.source.id)).toEqual(["state:s_in:img:current"]);
	});

	it("keeps a state per group instance", () => {
		const project = rootProject(
			[
				{ id: "a", type: "node-group", group: { definitionRef: "def", locked: false } },
				{ id: "b", type: "node-group", group: { definitionRef: "def", locked: false } },
				{ id: "sum", type: "add" },
			],
			[
				["a", "res", "sum", "operands"],
				["b", "res", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		const at = { x: 0, y: 0 };
		project.definitions.def = {
			label: "Simulating group",
			inputs: [{ id: "rate", label: "rate", type: "f32" }],
			outputs: [{ id: "res", label: "res", type: "f32" }],
			nodes: [
				{ id: "gi", type: "group-input", data: {}, position: at },
				{ id: "go", type: "group-output", data: {}, position: at },
				...simulation("gs", [ACC]).map((n) => ({ ...n, data: n.data ?? {}, position: at })),
				{ id: "step", type: "mul", data: {}, position: at },
				{ id: "next", type: "add", data: {}, position: at },
			],
			edges: [
				edge(["gi", "rate", "step", "operands"]),
				edge(["gs_in", "delta-time", "step", "operands"]),
				edge(["gs_in", "acc", "next", "operands"]),
				edge(["step", "result", "next", "operands"]),
				edge(["next", "result", "gs_out", "acc"]),
				edge(["gs_out", "acc", "go", "res"]),
			],
		};
		const plan = planFor(new GraphModel(project));
		const simulations = plan.passes.flatMap((p) => (p.simulation ? [p.simulation] : []));
		expect(simulations).toEqual([
			{ id: "a/gs_in", stage: "start" },
			{ id: "a/gs_in", stage: "step" },
			{ id: "b/gs_in", stage: "start" },
			{ id: "b/gs_in", stage: "step" },
		]);
		const main = plan.passes.at(-1);
		expect(main?.program.textures.map((t) => t.source.id)).toEqual([
			"state:a/gs_in:acc:current",
			"state:b/gs_in:acc:current",
		]);
	});

	it("renders a value of the zone to a texture from the previous state", () => {
		const graph = managerFor(
			[
				...simulation("s", [ACC]),
				{ id: "grey", type: "add" },
				{ id: "sample", type: "sample-texture" },
			],
			[
				["s_in", "acc", "grey", "operands"],
				["grey", "result", "sample", "texture"],
				["sample", "alpha", "s_out", "acc"],
				["s_out", "acc", "out", "color"],
			],
		);
		const plan = planFor(graph);
		expect(plan.passes.map((p) => [p.writes, p.simulation])).toEqual([
			[["state:s_in:acc:previous"], { id: "s_in", stage: "start" }],
			[["render:grey:result"], { id: "s_in" }],
			[["state:s_in:acc:current"], { id: "s_in", stage: "step" }],
			[[PLAN_TARGET], undefined],
		]);
	});
});
