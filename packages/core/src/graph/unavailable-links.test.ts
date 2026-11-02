import { describe, expect, it } from "bun:test";

import { generateShader } from "../codegen";
import { edge, managerFor } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { WgslType } from "../types";
import { type GraphDocumentNode, type GraphProject, ROOT_ID } from "./document";
import { GraphModel } from "./model";

const node = (id: string, type: string, data = {}): GraphDocumentNode =>
	({ id, type, data, position: { x: 0, y: 0 } }) as GraphDocumentNode;

/**
 * A group generic over T (vec3f or vec2f) negating its vector's Z, and an
 * instance per type; `linked` is the one feeding the output.
 */
function project(linked: "g2" | "g3"): GraphProject {
	const instance = (id: string, type: WgslType): GraphDocumentNode => ({
		...node(id, "node-group", { types: { T: type } }),
		group: { definitionRef: "def", locked: false },
	});
	return {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					node("out", "frag-output"),
					instance("g2", "vec2f"),
					instance("g3", "vec3f"),
				],
				edges: [edge([linked, "r", "out", "color"])],
			},
			def: {
				typeVariables: [{ id: "T", name: "T", types: ["vec3f", "vec2f"] }],
				inputs: [{ id: "v", label: "V", type: { variable: "T" } }],
				outputs: [{ id: "r", label: "R", type: "f32" }],
				nodes: [
					node("in", "group-input"),
					node("sep", "separate-vector"),
					node("neg", "negate"),
					node("go", "group-output"),
				],
				edges: [
					edge(["in", "v", "sep", "v"]),
					edge(["sep", "z", "neg", "e"]),
					edge(["neg", "result", "go", "r"]),
				],
			},
		},
	};
}

const zLink = "sep.z->neg.e";

describe("links to sockets that come and go with types", () => {
	it("are kept when the group is edited through an instance without them", () => {
		const graph = new GraphModel(project("g3"));
		graph.enterGroup("g2");
		graph.updateNodeData("sep", { label: "Split" });
		const def = graph.project.definitions.get("def");
		expect(def?.edges.map((e) => e.id)).toContain(zLink);
	});

	it("are unavailable only where their socket is missing", () => {
		const graph = new GraphModel(project("g3"));
		const def = graph.project.definitions.get("def");
		if (!def) throw new Error("no def");
		graph.enterGroup("g3");
		expect(graph.unavailableLinks(def).has(zLink)).toBe(false);
		graph.exitGroup();
		graph.enterGroup("g2");
		expect(graph.unavailableLinks(def).has(zLink)).toBe(true);
	});

	it("come back with their socket", () => {
		const graph = managerFor(
			[
				{ id: "d", type: "declare", data: { types: { declare: "vec3f" } } },
				{ id: "s", type: "separate-vector" },
			],
			[
				["d", "value", "s", "v"],
				["s", "z", "out", "color"],
			],
		);
		graph.setNodeType("d", "vec2f");
		expect(graph.unavailableLinks(graph.root).has("s.z->out.color")).toBe(true);
		graph.setNodeType("d", "vec3f");
		expect(graph.unavailableLinks(graph.root).size).toBe(0);
	});

	it.skipIf(!nagaBin)("are left out of the shader of an instance without them", () => {
		const { shader } = generateShader(new GraphModel(project("g2")));
		expect(validateFragment(shader)).toBeNull();
	});
});
