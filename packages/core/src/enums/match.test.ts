import { describe, expect, it } from "bun:test";

import { generateShader } from "../codegen";
import { type GraphDocumentNode, type GraphProject, ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import type { NodeType } from "../nodes/registry";
import { edge, type TestEdge } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { EnumVariant, NodeData, WgslType } from "../types";
import { caseHandle } from "./analysis";

const VARIANTS: EnumVariant[] = [
	{ value: 0, label: "Zero" },
	{ value: 2, label: "Two" },
	{ value: 5, label: "Five" },
];

const node = (id: string, type: NodeType, data: NodeData = {}): GraphDocumentNode => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

/**
 * A group picking, by its "mode" enum, a constant (Zero), its "x" input
 * (Two) or the time (Five). Its instance "g" feeds the output.
 */
function project(
	instance: NodeData = {},
	rootNodes: GraphDocumentNode[] = [],
	rootEdges: TestEdge[] = [],
): GraphProject {
	return {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					node("out", "frag-output"),
					{
						...node("g", "node-group", instance),
						group: { definitionRef: "def", locked: false },
					},
					...rootNodes,
				],
				edges: [["g", "result", "out", "color"] satisfies TestEdge, ...rootEdges].map(edge),
			},
			def: {
				inputs: [
					{ id: "mode", label: "Mode", type: "u32", variants: VARIANTS },
					{ id: "x", label: "X", type: "f32", owner: { enumId: "mode", value: 2 } },
				],
				outputs: [{ id: "result", label: "Result", type: "f32" }],
				nodes: [
					node("in", "group-input"),
					node("go", "group-output"),
					node("m", "match"),
					node("one", "declare", { values: { x: 1 } }),
					node("t", "time"),
				],
				edges: (
					[
						["in", "mode", "m", "selector"],
						["one", "value", "m", caseHandle(0)],
						["in", "x", "m", caseHandle(2)],
						["t", "seconds", "m", caseHandle(5)],
						["m", "result", "go", "result"],
					] satisfies TestEdge[]
				).map(edge),
			},
		},
	};
}

const caseIds = (graph: GraphModel) =>
	graph.resolveNodeInputs("m").map((i) => `${i.id}:${i.label}`);

describe("Match node", () => {
	it("has one case per variant of the enum linked to it", () => {
		const graph = new GraphModel(project());
		expect(caseIds(graph)).toEqual([
			"selector:enum",
			"case-0:Zero",
			"case-2:Two",
			"case-5:Five",
		]);
	});

	it("computes only the case picked by an enum value known while compiling", () => {
		const { shader } = generateShader(new GraphModel(project({ values: { mode: 2 } })));
		expect(shader).toContain("let v_m = h_x;");
		expect(shader).not.toContain("runtime_frame.time");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("picks the first case for a value matching no variant", () => {
		const { shader } = generateShader(new GraphModel(project({ values: { mode: 3 } })));
		expect(shader).toContain("let v_m = v_one;");
	});

	it("selects among every case when the value is only known in the shader", () => {
		const { shader } = generateShader(
			new GraphModel(project({}, [node("ft", "time")], [["ft", "seconds", "g", "mode"]])),
		);
		expect(shader).toContain(
			"select(select(v_one, h_x, h_mode == 2u), v_t_seconds, h_mode == 5u)",
		);
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("only lets an enum pick its case", () => {
		const graph = new GraphModel(project());
		graph.enterGroup("g");
		const link = { target: "m", targetHandle: "selector", sourceHandle: "seconds" };
		expect(graph.isValidConnection({ ...link, source: "t" })).toBe(false);
		expect(graph.isValidConnection({ ...link, source: "in", sourceHandle: "mode" })).toBe(true);
	});

	it("keeps links on their case through renames and reorders, drops removed cases'", () => {
		const graph = new GraphModel(project());
		const links = () =>
			graph.project.definitions
				.get("def")
				?.edges.filter((e) => e.target === "m")
				.map((e) => e.targetHandle);
		const [zero, two] = VARIANTS;
		if (!zero || !two) throw new Error("unreachable");
		graph.setHandleVariants("def", "mode", [{ ...two, label: "Deux" }, zero]);
		expect(caseIds(graph)).toEqual(["selector:enum", "case-2:Deux", "case-0:Zero"]);
		expect(links()).toEqual(["selector", "case-0", "case-2"]);
		graph.setHandleVariants("def", "mode", undefined);
		expect(caseIds(graph)).toEqual(["selector:enum"]);
		expect(links()).toEqual(["selector"]);
	});

	it("hides a group node's inputs under variants it isn't on", () => {
		const hidden = (
			data: NodeData,
			nodes: GraphDocumentNode[] = [],
			edges: TestEdge[] = [],
		) => [...new GraphModel(project(data, nodes, edges)).hiddenInputs("g")];
		expect(hidden({ values: { mode: 0 } })).toEqual(["x"]);
		expect(hidden({ values: { mode: 2 } })).toEqual([]);
		// Unknown while compiling: every variant's inputs.
		expect(hidden({}, [node("ft", "time")], [["ft", "seconds", "g", "mode"]])).toEqual([]);
		// Linked or not: its link stays, unused.
		expect(
			hidden({ values: { mode: 0 } }, [node("ft", "time")], [["ft", "seconds", "g", "x"]]),
		).toEqual(["x"]);
	});

	it("adds inputs to a variant after its enum's, nested enums included", () => {
		const graph = new GraphModel(project({ values: { mode: 2 } }));
		const top = graph.addHandle("def", "input", "f32");
		const sub = graph.addHandle("def", "input", "u32", {
			variants: [
				{ value: 0, label: "A" },
				{ value: 1, label: "B" },
			],
			owner: { enumId: "mode", value: 2 },
		});
		if (!top || !sub?.variants) throw new Error("unreachable");
		const z = graph.addHandle("def", "input", "f32", { owner: { enumId: sub.id, value: 1 } });
		if (!z) throw new Error("unreachable");
		const ids = () => graph.project.definitions.get("def")?.inputs.map((h) => h.id);
		expect(ids()).toEqual(["mode", "x", sub.id, z.id, top.id]);
		expect([...graph.hiddenInputs("g")]).toEqual([z.id]);
		graph.setInputValue("g", "mode", 0);
		expect([...graph.hiddenInputs("g")]).toEqual(["x", sub.id, z.id]);

		// Removing a variant, or an enum, removes the inputs under it.
		graph.setHandleVariants("def", sub.id, sub.variants.slice(0, 1));
		expect(ids()).toEqual(["mode", "x", sub.id, top.id]);
		graph.removeHandle("def", "input", "mode");
		expect(ids()).toEqual([top.id]);
	});

	it("lets inputs never shown together share a label", () => {
		const graph = new GraphModel(project());
		const y = graph.addHandle("def", "input", "f32", { owner: { enumId: "mode", value: 5 } });
		expect(y && graph.setHandleLabel("def", "input", y.id, "X")).toBe(true);
		expect(graph.setHandleLabel("def", "input", "mode", "X")).toBe(false);
	});

	it("replaces the group's inputs when removing or renaming one", () => {
		const graph = new GraphModel(project());
		const inputs = () => graph.project.definitions.get("def")?.inputs;
		const before = inputs();
		graph.setHandleLabel("def", "input", "x", "Renamed");
		graph.removeHandle("def", "input", "x");
		expect(inputs()).not.toBe(before);
		expect(before?.map((h) => h.label)).toEqual(["Mode", "X"]);
		expect(inputs()?.map((h) => h.id)).toEqual(["mode"]);
	});

	it("has a type picker, with or without an enum linked", () => {
		const graph = new GraphModel(project());
		expect(graph.typeChoice("m")?.inferable).toBe(true);
		const lone = new GraphModel({
			definitions: { [ROOT_ID]: { nodes: [node("m", "match")], edges: [] } },
		});
		expect(lone.typeChoice("m")?.types.length).toBeGreaterThan(1);
	});
});

describe("Component Count node", () => {
	/**
	 * A group generic over its "v" input's width, picking by its component
	 * count one of four constants (`c1`…`c4`). Its instance is fed a `type`.
	 */
	function generic(type: WgslType): GraphProject {
		return {
			definitions: {
				[ROOT_ID]: {
					nodes: [
						node("out", "frag-output"),
						node("src", "declare", { types: { declare: type } }),
						{
							...node("g", "node-group"),
							group: { definitionRef: "def", locked: false },
						},
					],
					edges: (
						[
							["src", "value", "g", "v"],
							["g", "result", "out", "color"],
						] satisfies TestEdge[]
					).map(edge),
				},
				def: {
					typeVariables: [
						{ id: "t", name: "T", types: ["f32", "vec2f", "vec3f", "vec4f"] },
					],
					inputs: [{ id: "v", label: "V", type: { variable: "t" } }],
					outputs: [{ id: "result", label: "Result", type: "f32" }],
					nodes: [
						node("in", "group-input"),
						node("go", "group-output"),
						node("count", "component-count"),
						node("m", "match"),
						...[1, 2, 3, 4].map((n) =>
							node(`c${String(n)}`, "declare", { values: { x: n } }),
						),
					],
					edges: (
						[
							["in", "v", "count", "value"],
							["count", "count", "m", "selector"],
							...[1, 2, 3, 4].map(
								(n) =>
									[
										`c${String(n)}`,
										"value",
										"m",
										caseHandle(n),
									] satisfies TestEdge,
							),
							["m", "result", "go", "result"],
						] satisfies TestEdge[]
					).map(edge),
				},
			},
		};
	}

	it("is an enum of widths a Match node can branch on", () => {
		const graph = new GraphModel(generic("vec2f"));
		expect(caseIds(graph)).toEqual([
			"selector:enum",
			"case-1:Scalar",
			"case-2:Vector 2",
			"case-3:Vector 3",
			"case-4:Vector 4",
		]);
		graph.enterGroup("g");
		const link = { target: "m", targetHandle: "selector", sourceHandle: "count" };
		expect(graph.isValidConnection({ ...link, source: "count" })).toBe(true);
	});

	it("is known while compiling, from the type its input takes in each instance", () => {
		for (const [type, picked] of [
			["f32", 1],
			["vec3f", 3],
			["vec4f", 4],
		] as const) {
			const { shader } = generateShader(new GraphModel(generic(type)));
			expect(shader).toContain(`let v_m = v_c${String(picked)};`);
			expect(shader).not.toContain(`v_c${String(picked === 1 ? 2 : 1)} =`);
			if (nagaBin) expect(validateFragment(shader)).toBeNull();
		}
	});
});
