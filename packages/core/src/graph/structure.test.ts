import { describe, expect, it } from "bun:test";

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
});
