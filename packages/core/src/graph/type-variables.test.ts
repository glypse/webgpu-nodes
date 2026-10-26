import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { evaluate } from "../testing/evaluate";
import { type TestEdge, edge } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import { FLOAT_TYPES, NUMERIC_TYPES, type WgslType } from "../types";
import { type GraphProject, ROOT_ID } from "./document";
import { GraphModel } from "./model";

const GROUP = "pairs";
const T = "t-id";
const U = "u-id";

/** A group adding two `T`s and multiplying two `U`s: two independent pairs. */
function project(sources: { a?: WgslType; c?: WgslType } = {}): GraphProject {
	const declare = (id: string, type: WgslType, x: number) => ({
		id,
		type: "declare",
		data: { types: { declare: type }, values: { x, y: x + 1, z: x + 2 } },
		position: { x: 0, y: 0 },
	});
	const at = { x: 0, y: 0 };
	const rootEdges: TestEdge[] = [["g", "sum", "out", "color"]];
	if (sources.a) rootEdges.push(["sa", "value", "g", "a"]);
	if (sources.c) rootEdges.push(["sc", "value", "g", "c"]);
	return {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					{ id: "out", type: "frag-output", data: {}, position: at },
					{
						id: "g",
						type: "node-group",
						data: {},
						position: at,
						group: { definitionRef: GROUP, locked: false },
					},
					...(sources.a ? [declare("sa", sources.a, 1)] : []),
					...(sources.c ? [declare("sc", sources.c, 3)] : []),
				],
				edges: rootEdges.map(edge),
			},
			[GROUP]: {
				label: "Pairs",
				typeVariables: [
					{ id: T, name: "T", types: FLOAT_TYPES },
					{ id: U, name: "U", types: NUMERIC_TYPES },
				],
				nodes: [
					{
						id: "in",
						type: "group-input",
						data: {
							handles: [
								{ id: "a", label: "A", type: { variable: T } },
								{ id: "b", label: "B", type: { variable: T } },
								{ id: "c", label: "C", type: { variable: U } },
								{ id: "d", label: "D", type: { variable: U } },
							],
							values: { b: 10, d: 2 },
						},
						position: at,
					},
					{ id: "add", type: "add", data: {}, position: at },
					{ id: "mul", type: "mul", data: {}, position: at },
					{
						id: "outs",
						type: "group-output",
						data: {
							handles: [
								{ id: "sum", label: "Sum", type: { variable: T } },
								{ id: "product", label: "Product", type: { variable: U } },
							],
						},
						position: at,
					},
				],
				edges: (
					[
						["in", "a", "add", "operands"],
						["in", "b", "add", "operands"],
						["in", "c", "mul", "operands"],
						["in", "d", "mul", "operands"],
						["add", "result", "outs", "sum"],
						["mul", "result", "outs", "product"],
					] satisfies TestEdge[]
				).map(edge),
			},
		},
	};
}

const bindingsOf = (graph: GraphModel) =>
	Object.fromEntries(graph.variableChoices("g").map((c) => [c.variable.name, c.type]));

describe("type variables", () => {
	it("decide each variable from its own sockets' links", () => {
		const graph = new GraphModel(project({ a: "vec3f", c: "i32" }));
		expect(bindingsOf(graph)).toEqual({ T: "vec3f", U: "i32" });
		expect(graph.resolveInputType("g", "b")).toBe("vec3f");
		expect(graph.resolveInputType("g", "d")).toBe("i32");
		expect(graph.resolveOutputHandleType("g", "sum")).toBe("vec3f");
		expect(graph.resolveOutputHandleType("g", "product")).toBe("i32");
	});

	it("take their first type with nothing linked", () => {
		const graph = new GraphModel(project());
		expect(bindingsOf(graph)).toEqual({ T: "f32", U: "f32" });
		const [t, u] = graph.variableChoices("g");
		expect(t?.inferable).toBe(true);
		expect(u?.forced).toBeUndefined();
	});

	it("can be forced on the group node, keeping what links infer apart", () => {
		const graph = new GraphModel(project({ a: "vec2f" }));
		graph.setVariableType("g", U, "vec4i");
		expect(bindingsOf(graph)).toEqual({ T: "vec2f", U: "vec4i" });
		const u = graph.variableChoices("g").find((c) => c.variable.id === U);
		expect(u).toMatchObject({ forced: "vec4i", inferred: "f32" });
		graph.setVariableType("g", U, undefined);
		expect(bindingsOf(graph).U).toBe("f32");
	});

	it("compute each group node with its own types", () => {
		const graph = new GraphModel(project({ a: "vec3f", c: "i32" }));
		expect(evaluate(graph, "g", "sum")).toEqual([11, 12, 13]);
		expect(evaluate(graph, "g", "product")).toEqual([6]);
		const { shader } = generateShader(graph);
		expect(shader).toContain("t_vec3f_i32(");
		expect(shader).toContain("struct GroupOutputs_h_pairs__vec3f_i32 {");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("emit one function per combination of types", () => {
		const base = project({ a: "vec3f" });
		const root = base.definitions[ROOT_ID];
		const group = root?.nodes.find((n) => n.id === "g");
		if (!root || !group) throw new Error("no group node");
		root.nodes.push({ ...group, id: "h" });
		root.edges.push(edge(["h", "sum", "out", "color"]));
		const graph = new GraphModel(base);
		const { shader } = generateShader(graph);
		expect(shader).toContain("fn group_h_pairs__t_vec3f_f32(");
		expect(shader).toContain("fn group_h_pairs__t_f32_f32(");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("show a group's inside with the types of the group node it was entered through", () => {
		const graph = new GraphModel(project({ a: "vec3f" }));
		expect(graph.resolveOutputHandleType("add", "result")).toBe("f32");
		graph.enterGroup("g");
		expect(graph.resolveOutputHandleType("add", "result")).toBe("vec3f");
		expect(graph.resolveOutputHandleType("in", "a")).toBe("vec3f");
		graph.exitGroup();
		expect(graph.resolveOutputHandleType("add", "result")).toBe("f32");
	});

	it("fix their sockets to their first type when removed", () => {
		const graph = new GraphModel(project({ a: "vec3f" }));
		graph.removeTypeVariable(GROUP, T);
		const handles = graph.project.definitions.get(GROUP)?.nodesById.get("in")?.data.handles;
		expect(handles?.find((h) => h.id === "a")?.type).toBe("f32");
		expect(graph.variableChoices("g").map((c) => c.variable.name)).toEqual(["U"]);
	});

	it("drop forced types and links a narrower set no longer allows", () => {
		const graph = new GraphModel(project({ c: "vec3i" }));
		graph.setVariableType("g", U, "vec3i");
		graph.setTypeVariable(GROUP, U, { types: ["f32"] });
		expect(graph.root.nodesById.get("g")?.data.types?.[U]).toBeUndefined();
		expect(graph.root.edges.some((e) => e.source === "sc")).toBe(false);
		expect(bindingsOf(graph).U).toBe("f32");
	});

	it("survive saving and loading", async () => {
		const graph = new GraphModel(project({ a: "vec2f" }));
		const loaded = new GraphModel(project());
		expect(await loaded.loadProject(JSON.parse(graph.getProjectJson()))).toBe(true);
		expect(bindingsOf(loaded)).toEqual({ T: "vec2f", U: "f32" });
	});

	it("name new variables after the next free letter", () => {
		const graph = new GraphModel(project());
		expect(graph.addTypeVariable(GROUP, FLOAT_TYPES)?.name).toBe("V");
	});
});
