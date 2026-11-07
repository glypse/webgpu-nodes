import { describe, expect, it } from "bun:test";

import { generateShader } from "../codegen";
import { type GraphDocumentNode, type GraphProject, ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import type { NodeType } from "../nodes/registry";
import { edge, type TestEdge } from "../testing/graph";
import { type NodeData, TOGGLE_VARIANTS, type WgslType } from "../types";
import { caseHandle } from "./analysis";

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
		// None of its types: nothing changes.
		graph.setHandleTypeOwner("def", "v", { variable: "T", types: ["f32"] });
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

/**
 * A group generic over "T" (vec2f or vec3f) whose "o" enum offers A for
 * vec2f, B for both and C for vec3f, "k" being under C. Its instance "g"
 * forces T to `type` and holds `value`.
 */
function variantProject(type: WgslType, value: number): GraphProject {
	return {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					node("out", "frag-output"),
					{
						...node("g", "node-group", { types: { T: type }, values: { o: value } }),
						group: { definitionRef: "def", locked: false },
					},
				],
				edges: [["g", "result", "out", "color"] satisfies TestEdge].map(edge),
			},
			def: {
				typeVariables: [{ id: "T", name: "T", types: ["vec2f", "vec3f"] }],
				inputs: [
					{ id: "v", label: "Vector", type: { variable: "T" } },
					{
						id: "o",
						label: "Option",
						type: "u32",
						variantsBy: "T",
						variants: [
							{ value: 0, label: "A", types: ["vec2f"] },
							{ value: 1, label: "B" },
							{ value: 2, label: "C", types: ["vec3f"] },
						],
					},
					{ id: "k", label: "K", type: "f32", owner: { enumId: "o", value: 2 } },
				],
				outputs: [{ id: "result", label: "Result", type: "f32" }],
				nodes: [
					node("in", "group-input"),
					node("go", "group-output"),
					node("m", "match"),
					...["a", "b", "c"].map((id, i) =>
						node(id, "declare", { types: { declare: "f32" }, values: { x: i } }),
					),
				],
				edges: (
					[
						["in", "o", "m", "selector"],
						["a", "value", "m", caseHandle(0)],
						["b", "value", "m", caseHandle(1)],
						["c", "value", "m", caseHandle(2)],
						["m", "result", "go", "result"],
					] satisfies TestEdge[]
				).map(edge),
			},
		},
	};
}

const offered = (graph: GraphModel) => {
	const control = graph.resolveNodeInputs("g").find((i) => i.id === "o")?.control;
	return control?.kind === "enum" ? control.variants.map((v) => v.label) : [];
};

describe("variants owned by types", () => {
	it("are offered only while their variable has one of their types", () => {
		expect(offered(new GraphModel(variantProject("vec2f", 1)))).toEqual(["A", "B"]);
		expect(offered(new GraphModel(variantProject("vec3f", 1)))).toEqual(["B", "C"]);
	});

	it("aren't picked with other types: the first variant offered is", () => {
		// C, under which "k" is, isn't offered for vec2f: A is picked.
		expect(hidden(new GraphModel(variantProject("vec2f", 2)))).toEqual(["k"]);
		expect(hidden(new GraphModel(variantProject("vec3f", 2)))).toEqual([]);
	});

	it("compile as the first variant offered with other types", () => {
		const shader = (type: WgslType) =>
			generateShader(new GraphModel(variantProject(type, 2))).shader;
		expect(shader("vec2f")).toContain("let v_m = v_a;");
		expect(shader("vec3f")).toContain("let v_m = v_c;");
	});

	const enumOf = (graph: GraphModel) =>
		graph.project.definitions.get("def")?.inputs.find((h) => h.id === "o");
	const types = (graph: GraphModel) => enumOf(graph)?.variants?.map((v) => v.types);

	it("follow their variable's types", () => {
		const graph = new GraphModel(variantProject("vec2f", 1));
		graph.setVariantOffered("def", "o", 1, "vec2f", false);
		expect(types(graph)).toEqual([["vec2f"], ["vec3f"], ["vec3f"]]);
		graph.removeTypeVariable("def", "T");
		expect(types(graph)).toEqual([undefined, undefined, undefined]);
		expect(enumOf(graph)?.variantsBy).toBeUndefined();
	});

	it("are offered for all of a type no variant would have", () => {
		const graph = new GraphModel(variantProject("vec2f", 1));
		graph.setVariantOffered("def", "o", 1, "vec2f", false);
		graph.setTypeVariable("def", "T", { types: ["vec2f", "vec3f", "vec4f"] });
		expect(types(graph)).toEqual([
			["vec2f", "vec4f"],
			["vec3f", "vec4f"],
			["vec3f", "vec4f"],
		]);
	});

	it("keep a variant for each type", () => {
		const graph = new GraphModel(variantProject("vec2f", 1));
		graph.setVariantOffered("def", "o", 1, "vec3f", false);
		graph.setVariantOffered("def", "o", 2, "vec3f", false);
		expect(types(graph)).toEqual([["vec2f"], ["vec2f"], ["vec3f"]]);
		// Removing the only variant for vec3f leaves all offering it.
		graph.setHandleVariants(
			"def",
			"o",
			enumOf(graph)?.variants?.filter((v) => v.value !== 2),
		);
		expect(types(graph)).toEqual([undefined, undefined]);
	});

	it("need no variant for the types their enum isn't shown for", () => {
		const graph = new GraphModel(variantProject("vec2f", 1));
		graph.setTypeVariable("def", "T", { types: ["vec2f", "vec3f", "vec4f"] });
		graph.setHandleTypeOwner("def", "o", { variable: "T", types: ["vec2f", "vec3f"] });
		graph.setVariantOffered("def", "o", 1, "vec3f", false);
		expect(types(graph)).toEqual([["vec2f"], ["vec2f"], ["vec3f"]]);
	});

	it("are all offered again without the enum's variable", () => {
		const graph = new GraphModel(variantProject("vec2f", 1));
		graph.setVariantsBy("def", "o", undefined);
		expect(enumOf(graph)?.variantsBy).toBeUndefined();
		expect(types(graph)).toEqual([undefined, undefined, undefined]);
		expect(offered(graph)).toEqual(["A", "B", "C"]);
		graph.setVariantsBy("def", "o", "T");
		expect(enumOf(graph)?.variantsBy).toBe("T");
		expect(offered(graph)).toEqual(["A", "B", "C"]);
	});
});

describe("checkbox enums", () => {
	it("stay checkboxes when their variants are renamed", () => {
		const graph = new GraphModel(project("vec3f"));
		const handle = graph.addHandle("def", "input", "bool", { variants: [...TOGGLE_VARIANTS] });
		expect(handle?.type).toBe("bool");
		expect(handle?.label).toBe("Checkbox 1");
		const id = handle?.id ?? "";
		graph.setHandleVariants("def", id, [
			{ value: 0, label: "No" },
			{ value: 1, label: "Yes" },
		]);
		const input = graph.project.definitions.get("def")?.inputs.find((h) => h.id === id);
		expect(input?.type).toBe("bool");
		expect(input?.variants?.map((v) => v.label)).toEqual(["No", "Yes"]);
	});
});

describe("compiled inputs", () => {
	const compiled = (graph: GraphModel, id: string) =>
		graph.project.definitions.get("def")?.inputs.find((h) => h.id === id)?.compiled;

	it("are integers", () => {
		const graph = new GraphModel(project("vec3f"));
		const id = graph.addHandle("def", "input", "i32")?.id ?? "";
		graph.setHandleCompiled("def", id, true);
		expect(compiled(graph, id)).toBe(true);
		graph.setHandleType("def", "input", id, "f32");
		expect(compiled(graph, id)).toBeUndefined();
		graph.setHandleCompiled("def", id, true);
		expect(compiled(graph, id)).toBeUndefined();
	});
});
