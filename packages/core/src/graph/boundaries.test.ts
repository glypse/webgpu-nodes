import { describe, expect, it } from "vitest";

import { addMenuEntries } from "../catalog/add-menu";
import { generateShader } from "../codegen";
import { evaluate } from "../testing/evaluate";
import { edge, rootProject } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { GraphProject } from "./document";
import { GraphModel } from "./model";

const at = { x: 0, y: 0 };

/**
 * A group doubling its input `a` into `twice` and tripling it into
 * `thrice`, through two Group Input and two Group Output nodes.
 */
function project(): GraphProject {
	const root = rootProject(
		[
			{ id: "two", type: "declare", data: { values: { x: 2 } } },
			{ id: "g", type: "node-group", group: { definitionRef: "def", locked: false } },
			{ id: "sum", type: "add" },
		],
		[
			["two", "value", "g", "a"],
			["g", "twice", "sum", "operands"],
			["g", "thrice", "sum", "operands"],
			["sum", "result", "out", "color"],
		],
	);
	root.definitions.def = {
		label: "Multiples",
		inputs: [{ id: "a", label: "A", type: "f32" }],
		outputs: [
			{ id: "twice", label: "Twice", type: "f32" },
			{ id: "thrice", label: "Thrice", type: "f32" },
		],
		nodes: [
			{ id: "in1", type: "group-input", data: {}, position: at },
			{ id: "in2", type: "group-input", data: { hideUnlinked: true }, position: at },
			{ id: "double", type: "mul", data: { values: { b: 2 } }, position: at },
			{ id: "triple", type: "mul", data: {}, position: at },
			{ id: "three", type: "declare", data: { values: { x: 3 } }, position: at },
			{ id: "out1", type: "group-output", data: {}, position: at },
			{ id: "out2", type: "group-output", data: {}, position: at },
		],
		edges: (
			[
				["in1", "a", "double", "operands"],
				["in1", "a", "double", "operands"],
				["in2", "a", "triple", "operands"],
				["three", "value", "triple", "operands"],
				["double", "result", "out1", "twice"],
				["triple", "result", "out2", "thrice"],
			] as const
		).map((e) => edge([...e])),
	};
	return root;
}

describe("several group boundary nodes", () => {
	it("all show the group's inputs, and each output comes from the node it's linked on", () => {
		const graph = new GraphModel(project());
		expect(graph.resolveNodeOutputs("in2", ["g"]).map((o) => o.id)).toEqual(["a"]);
		expect(evaluate(graph, "g", "twice")).toEqual([4]);
		expect(evaluate(graph, "g", "thrice")).toEqual([6]);
		const { shader } = generateShader(graph);
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("link an output on one Group Output node at a time", () => {
		const graph = new GraphModel(project());
		graph.enterGroup("g");
		graph.connect({
			source: "double",
			sourceHandle: "result",
			target: "out2",
			targetHandle: "twice",
		});
		const into = (id: string) =>
			graph.activeDocument.edgesByTarget.get(id)?.map((e) => e.targetHandle);
		expect(into("out1")).toBeUndefined();
		expect(into("out2")?.toSorted()).toEqual(["thrice", "twice"]);
	});

	it("are pasted back into their group only", () => {
		const graph = new GraphModel(project());
		graph.enterGroup("g");
		const clipboard = graph.copyNodes(["in1", "double"]);
		if (!clipboard) throw new Error("nothing copied");
		expect(graph.pasteNodes(clipboard)).toHaveLength(2);
		graph.exitGroup();
		expect(graph.pasteNodes(clipboard)).toHaveLength(1);
	});

	it("are offered in the add menu inside groups only", () => {
		const graph = new GraphModel(project());
		const boundaries = () =>
			addMenuEntries(graph)
				.filter((e) => e.type === "group-input" || e.type === "group-output")
				.map((e) => e.label);
		expect(boundaries()).toEqual([]);
		graph.enterGroup("g");
		expect(boundaries()).toEqual(["Group Input", "Group Output"]);
	});

	it("hide their unlinked sockets, all of them or none", () => {
		const graph = new GraphModel(project());
		graph.enterGroup("g");
		graph.toggleUnlinkedSockets(["in1", "in2"]);
		const hidden = (id: string) => graph.activeDocument.nodesById.get(id)?.data.hideUnlinked;
		expect([hidden("in1"), hidden("in2")]).toEqual([true, true]);
		graph.toggleUnlinkedSockets(["in1", "in2"]);
		expect([hidden("in1"), hidden("in2")]).toEqual([undefined, undefined]);
	});
});
