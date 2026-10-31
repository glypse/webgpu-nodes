import { describe, expect, it } from "vitest";

import { managerFor } from "../testing/graph";
import { pairedOutputId } from "../zones";

/** Three Sine nodes in a chain: a → b → c. */
function chain() {
	return managerFor(
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
}

describe("GraphModel copy and paste", () => {
	it("pastes copies with their inner links, selected, at the position given", () => {
		const graph = chain();
		const clipboard = graph.copyNodes(["a", "b"]);
		if (!clipboard) throw new Error("nothing copied");
		expect(clipboard.edges).toHaveLength(1);

		const ids = graph.pasteNodes(clipboard, { x: 1000, y: 500 });
		expect(ids).toHaveLength(2);
		const copies = ids.map((id) => graph.root.nodesById.get(id));
		expect(copies.map((n) => n?.position)).toEqual([
			{ x: 1000, y: 500 },
			{ x: 1200, y: 500 },
		]);
		expect(copies.every((n) => n?.selected)).toBe(true);
		expect(graph.selectedNodeIds).toEqual(ids);
		expect(graph.root.edges).toContainEqual(
			expect.objectContaining({ source: ids[0], target: ids[1] }),
		);
	});

	it("never copies a document's output", () => {
		const graph = chain();
		expect(graph.copyNodes(["out"])).toBeUndefined();
	});

	it("copies a zone whole", () => {
		const graph = chain();
		const zoneId = graph.createRepeatZone({ x: 0, y: 0 });
		if (!zoneId) throw new Error("zone not created");
		const clipboard = graph.copyNodes([zoneId]);
		expect(clipboard?.nodes.map((n) => n.type).toSorted()).toEqual([
			"repeat-input",
			"repeat-output",
		]);
		const ids = graph.duplicateNodes([zoneId]);
		const input = ids
			.map((id) => graph.root.nodesById.get(id))
			.find((n) => n?.type === "repeat-input");
		expect(input && pairedOutputId(input)).toBe(ids.find((id) => id !== input?.id));
	});
});

describe("GraphModel delete and dissolve", () => {
	it("deletes nodes with their links", () => {
		const graph = chain();
		expect(graph.deleteNodes(["b"])).toBe(true);
		expect(graph.root.nodesById.has("b")).toBe(false);
		expect(graph.root.edges).toEqual([]);
		expect(graph.deleteNodes(["out"])).toBe(false);
	});

	it("dissolves nodes, linking what fed them to what they fed", () => {
		const graph = chain();
		expect(graph.dissolveNodes(["b"])).toBe(true);
		expect(graph.root.edges).toEqual([
			expect.objectContaining({
				source: "a",
				sourceHandle: "result",
				target: "c",
				targetHandle: "e",
			}),
		]);
	});

	it("dissolves a chain of nodes at once", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
				{ id: "c", type: "sin" },
				{ id: "d", type: "sin" },
			],
			[
				["a", "result", "b", "e"],
				["b", "result", "c", "e"],
				["c", "result", "d", "e"],
			],
		);
		graph.dissolveNodes(["b", "c"]);
		expect(graph.root.edges).toEqual([
			expect.objectContaining({ source: "a", target: "d", targetHandle: "e" }),
		]);
	});
});

describe("GraphModel reset", () => {
	it("puts input values back to their defaults", () => {
		const graph = chain();
		graph.setInputValue("a", "e", 3);
		graph.resetNodes(["a"]);
		expect(graph.root.nodesById.get("a")?.data.values).toEqual({ e: 0 });
	});
});
