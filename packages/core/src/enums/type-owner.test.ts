import { describe, expect, it } from "bun:test";

import { type GraphDocumentNode, type GraphProject, ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import type { NodeType } from "../nodes/registry";
import { edge, type TestEdge } from "../testing/graph";
import type { NodeData, WgslType } from "../types";

const node = (id: string, type: NodeType, data: NodeData = {}): GraphDocumentNode => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const VARIANTS = [
	{ value: 0, label: "A" },
	{ value: 1, label: "B" },
];

/**
 * A group generic over "T" (vec2f, vec3f or vec4f), its vector "v" of T; an
 * Orientation enum for vec2f and one for vec3f, the latter with an input
 * "k" under its variant B; "s" shown for vec3f and vec4f. Its instance "g"
 * forces T to `type`.
 */
function project(type: WgslType): GraphProject {
	return {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					node("out", "frag-output"),
					{
						...node("g", "node-group", { types: { T: type }, values: { o3: 1 } }),
						group: { definitionRef: "def", locked: false },
					},
				],
				edges: [["g", "result", "out", "color"] satisfies TestEdge].map(edge),
			},
			def: {
				typeVariables: [{ id: "T", name: "T", types: ["vec2f", "vec3f", "vec4f"] }],
				inputs: [
					{ id: "v", label: "Vector", type: { variable: "T" } },
					{
						id: "o2",
						label: "Orientation",
						type: "u32",
						variants: VARIANTS,
						typeOwner: { variable: "T", types: ["vec2f"] },
					},
					{
						id: "o3",
						label: "Orientation",
						type: "u32",
						variants: VARIANTS,
						typeOwner: { variable: "T", types: ["vec3f"] },
					},
					{ id: "k", label: "K", type: "f32", owner: { enumId: "o3", value: 1 } },
					{
						id: "s",
						label: "S",
						type: "f32",
						typeOwner: { variable: "T", types: ["vec3f", "vec4f"] },
					},
				],
				outputs: [{ id: "result", label: "Result", type: "f32" }],
				nodes: [node("in", "group-input"), node("go", "group-output")],
				edges: [],
			},
		},
	};
}

const hidden = (graph: GraphModel) => [...graph.hiddenInputs("g")].sort();

describe("inputs owned by types", () => {
	it("are shown only while their variable has one of their types", () => {
		expect(hidden(new GraphModel(project("vec2f")))).toEqual(["k", "o3", "s"]);
		expect(hidden(new GraphModel(project("vec3f")))).toEqual(["o2"]);
		// Under an enum that's hidden by its type, though on its variant.
		expect(hidden(new GraphModel(project("vec4f")))).toEqual(["k", "o2", "o3"]);
	});

	it("may share a label with inputs never shown for the same types", () => {
		const graph = new GraphModel(project("vec2f"));
		expect(graph.setHandleLabel("def", "input", "s", "Orientation")).toBe(false);
		expect(graph.setHandleLabel("def", "input", "o2", "S")).toBe(true);
	});

	it("follow their variable's types, and are shown for all without it", () => {
		const graph = new GraphModel(project("vec3f"));
		const owners = () =>
			Object.fromEntries(
				(graph.project.definitions.get("def")?.inputs ?? []).map((h) => [
					h.id,
					h.typeOwner?.types,
				]),
			);
		graph.setTypeVariable("def", "T", { types: ["vec2f", "vec3f"] });
		expect(owners()).toMatchObject({ o2: ["vec2f"], o3: ["vec3f"], s: ["vec3f"] });
		// Shown for every type it may still take: owned by none.
		graph.setTypeVariable("def", "T", { types: ["vec3f"] });
		expect(owners()).toMatchObject({ o2: undefined, o3: undefined, s: undefined });
		graph.setTypeVariable("def", "T", { types: ["vec2f", "vec3f"] });
		graph.setHandleTypeOwner("def", "o2", { variable: "T", types: ["vec2f"] });
		graph.removeTypeVariable("def", "T");
		expect(owners()).toMatchObject({ o2: undefined });
	});

	it("are set within their variable's types", () => {
		const graph = new GraphModel(project("vec3f"));
		const owner = () =>
			graph.project.definitions.get("def")?.inputs.find((h) => h.id === "v")?.typeOwner;
		graph.setHandleTypeOwner("def", "v", { variable: "T", types: ["vec4f", "f32"] });
		expect(owner()).toEqual({ variable: "T", types: ["vec4f"] });
		graph.setHandleTypeOwner("def", "v", undefined);
		expect(owner()).toBeUndefined();
	});

	it("save and load", async () => {
		const graph = new GraphModel(project("vec3f"));
		const copy = new GraphModel(project("vec2f"));
		expect(await copy.loadFromString(graph.getProjectJson())).toBe(true);
		expect(hidden(copy)).toEqual(["o2"]);
	});
});
