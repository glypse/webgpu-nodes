import { describe, expect, it } from "vitest";

import { FLOAT_TYPES, type NodeDescriptor } from ".";
import type { GraphDocumentEdge, GraphNode } from "../graph/document";
import { TypeResolver } from "./resolver";

const pair: NodeDescriptor = {
	type: "pair",
	label: "Pair",
	category: "math",
	inputs: [
		{ id: "a", label: "a", types: FLOAT_TYPES, family: "first" },
		{ id: "b", label: "b", types: FLOAT_TYPES, family: "second" },
		{ id: "c", label: "c", types: FLOAT_TYPES, family: "second" },
	],
	outputs: [{ id: "out", label: "out", type: "f32" }],
	defaultData: {},
	wgsl: () => [],
};

const vec3: NodeDescriptor = {
	type: "vec3",
	label: "Vec3",
	category: "input",
	staticOutputTypes: true,
	inputs: [],
	outputs: [{ id: "v", label: "v", type: "vec3f" }],
	defaultData: {},
	wgsl: () => [],
};

describe("type families", () => {
	const node: GraphNode = { id: "n", type: "pair", data: {}, position: { x: 0, y: 0 } };
	const nodes = new Map<string, GraphNode>([
		["n", node],
		["v", { id: "v", type: "vec3", data: {}, position: { x: 0, y: 0 } }],
	]);
	const edges: GraphDocumentEdge[] = [
		{ id: "e", source: "v", sourceHandle: "v", target: "n", targetHandle: "b" },
	];
	const resolver = new TypeResolver(
		(node) => (node.type === "pair" ? pair : vec3),
		new Map(),
		(id) => edges.filter((e) => e.target === id),
	);

	it("keeps inputs of different family keys apart, even accepting the same types", () => {
		const resolved = resolver.resolveNodeTypes(node, edges, (id) => nodes.get(id));
		expect(resolved.inputTypes).toEqual({ a: "f32", b: "vec3f", c: "vec3f" });
	});
});
