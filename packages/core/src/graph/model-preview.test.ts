import { describe, expect, it } from "vitest";

import { managerFor } from "../testing/graph";
import type { GraphModel } from "./model";

function linksIntoOutput(graph: GraphModel) {
	return graph.root.edges.filter((e) => e.target === "out" && e.targetHandle === "color");
}

/** The group node made of `a` and `b`, with `c` outside it. */
function grouped() {
	const graph = managerFor(
		[
			{ id: "a", type: "sin" },
			{ id: "b", type: "sin" },
			{ id: "c", type: "sin" },
		],
		[
			["a", "result", "b", "e"],
			["b", "result", "c", "e"],
		],
	);
	graph.groupSelection(new Set(["a", "b"]));
	const group = graph.root.nodes.find((n) => n.type === "node-group");
	if (!group?.group) throw new Error("not grouped");
	return { graph, groupId: group.id, ref: group.group.definitionRef };
}

function viewersOf(graph: GraphModel, ref: string) {
	const output = graph.project.definitions.get(ref)?.nodes.find((n) => n.type === "group-output");
	return (output?.data.handles ?? []).filter((h) => h.viewer);
}

describe("GraphModel previewNode", () => {
	it("links a node straight to the output, replacing its link", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
			],
			[],
		);
		expect(graph.previewNode("a")).toBe(true);
		expect(graph.previewNode("b")).toBe(true);
		expect(linksIntoOutput(graph)).toEqual([
			expect.objectContaining({ source: "b", sourceHandle: "result" }),
		]);
	});

	it("goes to the next output when the node is already previewed", () => {
		const graph = managerFor([], []);
		const zoneId = graph.createRepeatZone({ x: 0, y: 0 });
		if (!zoneId) throw new Error("zone not created");
		const outputs = graph.resolveNodeOutputs(zoneId).map((o) => o.id);
		expect(outputs.length).toBeGreaterThan(1);
		const previewed = () => linksIntoOutput(graph)[0]?.sourceHandle;
		graph.previewNode(zoneId);
		expect(previewed()).toBe(outputs[0]);
		graph.previewNode(zoneId);
		expect(previewed()).toBe(outputs[1]);
	});

	it("carries a preview out of a group through a viewer output", () => {
		const { graph, groupId, ref } = grouped();
		graph.enterGroup(groupId);
		expect(graph.previewNode("a")).toBe(true);
		const [viewer] = viewersOf(graph, ref);
		if (!viewer) throw new Error("no viewer output");
		const definition = graph.project.definitions.get(ref);
		expect(definition?.edges).toContainEqual(
			expect.objectContaining({ source: "a", targetHandle: viewer.id }),
		);
		expect(linksIntoOutput(graph)).toEqual([
			expect.objectContaining({ source: groupId, sourceHandle: viewer.id }),
		]);

		// Another node of the group reuses the viewer output.
		graph.previewNode("b");
		expect(viewersOf(graph, ref)).toEqual([viewer]);
	});

	it("removes viewer outputs a preview no longer goes through", () => {
		const { graph, groupId, ref } = grouped();
		graph.enterGroup(groupId);
		graph.previewNode("a");
		graph.exitGroup();
		graph.previewNode("c");
		expect(viewersOf(graph, ref)).toEqual([]);
		expect(graph.root.edges.some((e) => e.source === groupId && e.target === "out")).toBe(
			false,
		);
		expect(linksIntoOutput(graph)).toEqual([expect.objectContaining({ source: "c" })]);
	});

	it("leaves nodes without outputs alone", () => {
		const graph = managerFor([], []);
		expect(graph.previewNode("out")).toBe(false);
	});
});
