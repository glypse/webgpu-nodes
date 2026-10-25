import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { type GraphDocumentNode, type GraphProject, ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, type TestEdge } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { EnumVariant, NodeData } from "../types";
import { caseHandle } from "./analysis";

const VARIANTS: EnumVariant[] = [
	{ value: 0, label: "Zero" },
	{ value: 2, label: "Two" },
	{ value: 5, label: "Five" },
];

const node = (id: string, type: string, data: NodeData = {}): GraphDocumentNode => ({
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
				nodes: [
					node("in", "group-input", {
						handles: [
							{ id: "mode", label: "Mode", type: "u32", variants: VARIANTS },
							{
								id: "x",
								label: "X",
								type: "f32",
								owner: { enumId: "mode", value: 2 },
							},
						],
					}),
					node("go", "group-output", {
						handles: [{ id: "result", label: "Result", type: "f32" }],
					}),
					node("m", "match"),
					node("one", "declare", { values: { x: 1 } }),
					node("t", "time"),
				],
				edges: (
					[
						["in", "mode", "m", "selector"],
						["one", "value", "m", caseHandle(0)],
						["in", "x", "m", caseHandle(2)],
						["t", "time", "m", caseHandle(5)],
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
		expect(shader).not.toContain("spektralFrame.time");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("picks the first case for a value matching no variant", () => {
		const { shader } = generateShader(new GraphModel(project({ values: { mode: 3 } })));
		expect(shader).toContain("let v_m = v_one;");
	});

	it("selects among every case when the value is only known in the shader", () => {
		const { shader } = generateShader(
			new GraphModel(project({}, [node("ft", "time")], [["ft", "time", "g", "mode"]])),
		);
		expect(shader).toContain("select(select(v_one, h_x, h_mode == 2u), v_t, h_mode == 5u)");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("only lets an enum pick its case", () => {
		const graph = new GraphModel(project());
		graph.enterGroup("g");
		const link = { target: "m", targetHandle: "selector", sourceHandle: "time" };
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
		graph.setHandleVariants("def", "in", "mode", [{ ...two, label: "Deux" }, zero]);
		expect(caseIds(graph)).toEqual(["selector:enum", "case-2:Deux", "case-0:Zero"]);
		expect(links()).toEqual(["selector", "case-0", "case-2"]);
		graph.setHandleVariants("def", "in", "mode", undefined);
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
		expect(hidden({}, [node("ft", "time")], [["ft", "time", "g", "mode"]])).toEqual([]);
		expect(
			hidden({ values: { mode: 0 } }, [node("ft", "time")], [["ft", "time", "g", "x"]]),
		).toEqual([]);
	});

	it("adds inputs to a variant after its enum's, nested enums included", () => {
		const graph = new GraphModel(project({ values: { mode: 2 } }));
		const top = graph.addHandle("in", "f32");
		const sub = graph.addHandle("in", "u32", {
			variants: [
				{ value: 0, label: "A" },
				{ value: 1, label: "B" },
			],
			owner: { enumId: "mode", value: 2 },
		});
		const z = sub && graph.addHandle("in", "f32", { owner: { enumId: sub.id, value: 1 } });
		const ids = () =>
			graph.project.definitions
				.get("def")
				?.nodesById.get("in")
				?.data.handles?.map((h) => h.id);
		expect(ids()).toEqual(["mode", "x", sub?.id, z?.id, top?.id]);
		expect([...graph.hiddenInputs("g")]).toEqual([z?.id]);
		graph.setInputValue("g", "mode", 0);
		expect([...graph.hiddenInputs("g")]).toEqual(["x", sub?.id, z?.id]);

		// Removing a variant, or an enum, removes the inputs under it.
		if (!sub?.variants) throw new Error("unreachable");
		graph.setHandleVariants("def", "in", sub.id, sub.variants.slice(0, 1));
		expect(ids()).toEqual(["mode", "x", sub.id, top?.id]);
		graph.removeHandle("def", "in", "mode");
		expect(ids()).toEqual([top?.id]);
	});

	it("lets inputs never shown together share a label", () => {
		const graph = new GraphModel(project());
		const y = graph.addHandle("in", "f32", { owner: { enumId: "mode", value: 5 } });
		expect(y && graph.setHandleLabel("def", "in", y.id, "X")).toBe(true);
		expect(graph.setHandleLabel("def", "in", "mode", "X")).toBe(false);
	});

	it("replaces the group input node when removing or renaming a handle", () => {
		const graph = new GraphModel(project());
		const inputNode = () => graph.project.definitions.get("def")?.nodesById.get("in");
		const before = inputNode();
		graph.setHandleLabel("def", "in", "x", "Renamed");
		graph.removeHandle("def", "in", "x");
		expect(inputNode()).not.toBe(before);
		expect(before?.data.handles?.map((h) => h.label)).toEqual(["Mode", "X"]);
		expect(inputNode()?.data.handles?.map((h) => h.id)).toEqual(["mode"]);
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
