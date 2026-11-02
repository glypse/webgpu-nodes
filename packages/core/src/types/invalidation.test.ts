import { expect, it } from "bun:test";

import { type GraphDocumentNode, type GraphProject, ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge } from "../testing/graph";

const node = (id: string, type: string, data = {}): GraphDocumentNode =>
	({ id, type, data, position: { x: 0, y: 0 } }) as GraphDocumentNode;

const instance = (id: string, definitionRef: string): GraphDocumentNode => ({
	...node(id, "node-group"),
	group: { definitionRef, locked: false },
});

/** A group "outer" calling "inner", which outputs a Declare; each output takes what reaches it. */
const project: GraphProject = {
	definitions: {
		[ROOT_ID]: {
			nodes: [node("out", "frag-output"), instance("g", "outer")],
			edges: [edge(["g", "r", "out", "color"])],
		},
		outer: {
			outputs: [{ id: "r", label: "R", type: { inferred: true } }],
			nodes: [instance("i", "inner"), node("go", "group-output")],
			edges: [edge(["i", "r", "go", "r"])],
		},
		inner: {
			outputs: [{ id: "r", label: "R", type: { inferred: true } }],
			nodes: [
				node("d", "declare", { types: { declare: "f32" } }),
				node("go2", "group-output"),
			],
			edges: [edge(["d", "value", "go2", "r"])],
		},
	},
};

it("follows a change through the groups calling the group it's in", () => {
	const graph = new GraphModel(project);
	expect(graph.resolveOutputHandleType("g", "r")).toBe("f32");
	graph.setNodeType("d", "vec3f");
	expect(graph.resolveOutputHandleType("g", "r")).toBe("vec3f");
});
