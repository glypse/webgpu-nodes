import { describe, expect, it } from "bun:test";

import { LAYOUT_FRAME } from "../frames";
import type { GraphNode, HydratedGraphDocument } from "./document";
import { nodesStructure } from "./structure";

function doc(nodes: GraphNode[]): HydratedGraphDocument {
	return { nodes } as HydratedGraphDocument;
}

const node: GraphNode = { id: "a", type: "time", data: {}, position: { x: 0, y: 0 } };

describe("nodesStructure", () => {
	it("stays the same when nodes are only moved, resized or selected", () => {
		const d = doc([node]);
		const before = nodesStructure(d);
		d.nodes = [{ ...node, position: { x: 5, y: 9 }, width: 40, selected: true }];
		expect(nodesStructure(d)).toBe(before);
	});

	it("changes when a node's data, type or count changes", () => {
		const d = doc([node]);
		const before = nodesStructure(d);
		d.nodes = [{ ...node, data: {} }];
		const edited = nodesStructure(d);
		expect(edited).not.toBe(before);
		d.nodes = [...d.nodes, { ...node, id: "b" }];
		expect(nodesStructure(d)).not.toBe(edited);
	});

	it("stays the same when nodes move into or out of frames, and frames are added or edited", () => {
		const frame: GraphNode = {
			id: "f",
			type: LAYOUT_FRAME,
			data: {},
			position: { x: 0, y: 0 },
		};
		const d = doc([node, frame]);
		const before = nodesStructure(d);
		d.nodes = [{ ...node, frame: "f" }, frame];
		expect(nodesStructure(d)).toBe(before);
		d.nodes = [
			{ ...node, frame: "f" },
			{ ...frame, data: { label: "Renamed" } },
		];
		expect(nodesStructure(d)).toBe(before);
		d.nodes = [...d.nodes, { ...frame, id: "g" }];
		expect(nodesStructure(d)).toBe(before);
		d.nodes = [node];
		expect(nodesStructure(d)).toBe(before);
	});

	it("stays the same when only inert inputs' values change", () => {
		const inert = (_: GraphNode, input: string) => input === "x";
		const d = doc([{ ...node, data: { values: { x: 1, y: 2 } } }]);
		const before = nodesStructure(d, inert);
		d.nodes = [{ ...node, data: { values: { x: 5, y: 2 } } }];
		expect(nodesStructure(d, inert)).toBe(before);
		d.nodes = [{ ...node, data: { values: { x: 5, y: 3 } } }];
		const edited = nodesStructure(d, inert);
		expect(edited).not.toBe(before);
		d.nodes = [{ ...node, data: { values: { x: 5, y: 3 }, label: "L" } }];
		expect(nodesStructure(d, inert)).not.toBe(edited);
	});
});
