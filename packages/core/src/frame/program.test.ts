import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { ROOT_ID } from "../graph/document";
import type { GraphDocumentNode, GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { FLOAT_TYPES } from "../types";
import { evaluateFrame, FrameCompiler, type FrameEnv, type FrameProgram } from "./program";

const at = { x: 0, y: 0 };

const ENV: FrameEnv = {
	time: 3,
	delta: 0.5,
	frame: 7,
	canvas: { width: 640, height: 360 },
	passSize: { width: 320, height: 180 },
};

const IMAGE: Asset = {
	kind: "image",
	id: "wide",
	name: "wide",
	file: "assets/images/wide.png",
	mime: "image/png",
	bytes: 1,
	hash: "wide",
	width: 1001,
	height: 500,
};

function compiler(model: GraphModel, uniformScopes: string[] = []) {
	return new FrameCompiler(model, model.frameValueAnalysis(), model.passAnalysis().sources, {
		uniformScopes: new Set(uniformScopes),
	});
}

function model(nodes: TestNode[], edges: TestEdge[], assets: Asset[] = []) {
	return new GraphModel({ ...rootProject(nodes, edges), assets });
}

describe("frame programs", () => {
	it("evaluate maths on Time", () => {
		const graph = model(
			[
				{ id: "time", type: "time" },
				{ id: "two", type: "declare", data: { values: { x: 2 } } },
				{ id: "double", type: "mul" },
			],
			[
				["time", "seconds", "double", "operands"],
				["two", "value", "double", "operands"],
			],
		);
		const frame = compiler(graph);
		const arg = frame.arg([], "double", "result");
		const values = evaluateFrame(frame.program(), ENV);
		expect(arg && values.arg(arg)).toBe(6);
		expect(compiler(graph).arg([], "double", "result")).toEqual(arg);
	});

	it("evaluate ceil(log2(texture width)) of a texture 1001 pixels wide", () => {
		const graph = model(
			[
				{ id: "img", type: "image", data: { asset: "wide" } },
				{ id: "size", type: "texture-size" },
				{ id: "x", type: "separate-vector" },
				{ id: "log", type: "log" },
				{ id: "two", type: "declare", data: { values: { x: 2 } } },
				{ id: "log2", type: "log" },
				{ id: "div", type: "div" },
				{ id: "ceil", type: "ceil" },
			],
			[
				["img", "texture", "size", "texture"],
				["size", "size", "x", "v"],
				["x", "x", "log", "e"],
				["two", "value", "log2", "e"],
				["log", "result", "div", "a"],
				["log2", "result", "div", "b"],
				["div", "result", "ceil", "e"],
			],
			[IMAGE],
		);
		const frame = compiler(graph);
		const arg = frame.arg([], "ceil", "result");
		const textureSize = (id: string) =>
			id === "media:wide" ? { width: 1001, height: 500 } : undefined;
		const values = evaluateFrame(frame.program(), { ...ENV, textureSize });
		expect(arg && values.arg(arg)).toBe(10);
		// The same maths for another texture: 1000 wide is 9.97 octaves, 2000 wide 10.97.
		const wider = evaluateFrame(frame.program(), {
			...ENV,
			textureSize: () => ({ width: 2000, height: 1 }),
		});
		expect(arg && wider.arg(arg)).toBe(11);
	});

	it("fold what reads only literals", () => {
		const graph = model(
			[
				{ id: "a", type: "declare", data: { values: { x: 1.5 } } },
				{ id: "b", type: "declare", data: { values: { x: 2 } } },
				{ id: "sum", type: "add" },
			],
			[
				["a", "value", "sum", "operands"],
				["b", "value", "sum", "operands"],
			],
		);
		const frame = compiler(graph);
		expect(frame.arg([], "sum", "result")).toBe(3.5);
		expect(frame.program().steps).toHaveLength(0);
	});

	it("read unlinked inputs as uniforms in the scopes asked", () => {
		const graph = model(
			[
				{ id: "time", type: "time" },
				{ id: "d", type: "declare", data: { values: { x: 4 } } },
				{ id: "sum", type: "add" },
			],
			[
				["time", "seconds", "sum", "operands"],
				["d", "value", "sum", "operands"],
			],
		);
		const frame = compiler(graph, [ROOT_ID]);
		const arg = frame.arg([], "sum", "result");
		expect(frame.uniforms).toEqual({ u_d_x: 4 });
		const values = evaluateFrame(frame.program(), { ...ENV, uniforms: { u_d_x: 10 } });
		expect(arg && values.arg(arg)).toBe(13);
	});

	it("evaluate a group instance's value with the types it's given", () => {
		const project = rootProject(
			[
				{
					id: "v",
					type: "declare",
					data: { types: { declare: "vec2f" }, values: { x: 3, y: 4 } },
				},
				{ id: "sq", type: "node-group", group: { definitionRef: "square", locked: false } },
				{ id: "y", type: "separate-vector" },
			],
			[
				["v", "value", "sq", "a"],
				["sq", "b", "y", "v"],
			],
		);
		project.definitions.square = {
			label: "Square",
			typeVariables: [{ id: "t", name: "T", types: FLOAT_TYPES }],
			inputs: [{ id: "a", label: "A", type: { variable: "t" } }],
			outputs: [{ id: "b", label: "B", type: { variable: "t" } }],
			nodes: [
				{ id: "gin", type: "group-input", data: {}, position: at },
				{ id: "mul", type: "mul", data: {}, position: at },
				{ id: "gout", type: "group-output", data: {}, position: at },
			],
			edges: [
				edge(["gin", "a", "mul", "operands"]),
				edge(["gin", "a", "mul", "operands"]),
				edge(["mul", "result", "gout", "b"]),
			],
		};
		const graph = new GraphModel(project);
		const frame = compiler(graph);
		expect(frame.compile([], "sq", "b")?.input).toEqual({ literal: [9, 16], type: "vec2f" });
		expect(frame.arg([], "y", "y")).toBe(16);
	});

	it("run a repeat zone", () => {
		const graph = new GraphModel(rootProject([{ id: "time", type: "time" }], []));
		const zone = graph.createRepeatZone(at) ?? "";
		const output = graph.root.nodesById.get(zone)?.data.pairedOutput ?? "";
		const item = graph.getZoneItems(zone)[0]?.id ?? "";
		const next = graph.addNode("add", at) ?? "";
		const link = (
			source: string,
			sourceHandle: string,
			target: string,
			targetHandle: string,
		) => {
			graph.connect({ source, sourceHandle, target, targetHandle });
		};
		link(zone, item, next, "operands");
		link(zone, "iteration", next, "operands");
		link(next, "result", output, item);
		link("time", "seconds", zone, item);
		link("time", "frame", zone, "iterations");
		const frame = compiler(graph);
		const arg = frame.arg([], output, item);
		// Time 3, then plus the iterations 0, 1, 2, 3, 4, 5, 6.
		const values = evaluateFrame(frame.program(), ENV);
		expect(arg && values.arg(arg)).toBe(3 + 21);
		const later = evaluateFrame(frame.program(), { ...ENV, frame: 2, time: 0 });
		expect(arg && later.arg(arg)).toBe(1);
	});

	it("don't compile what differs per pixel", () => {
		const graph = model([{ id: "uv", type: "uv" }], [["uv", "uv", "out", "color"]]);
		expect(compiler(graph).compile([], "uv", "uv")).toBeUndefined();
	});

	describe("with groups in a repeat zone", () => {
		type Definition = GraphProject["definitions"][string];
		const raw = (
			id: string,
			type: string,
			data: GraphProject["definitions"][string]["nodes"][number]["data"] = {},
		): GraphDocumentNode => ({
			id,
			type: type as GraphDocumentNode["type"],
			data,
			position: at,
		});
		const group = (id: string, definitionRef: string): TestNode => ({
			id,
			type: "node-group",
			group: { definitionRef, locked: false },
		});

		/** A group giving `a` times 2. */
		const double = (): Definition => ({
			label: "Double",
			inputs: [{ id: "a", label: "A", type: "f32" }],
			outputs: [{ id: "b", label: "B", type: "f32" }],
			nodes: [
				raw("gin", "group-input"),
				raw("two", "declare", { values: { x: 2 } }),
				raw("mul", "mul"),
				raw("gout", "group-output"),
			],
			edges: [
				edge(["gin", "a", "mul", "operands"]),
				edge(["two", "value", "mul", "operands"]),
				edge(["mul", "result", "gout", "b"]),
			],
		});

		/** The zone every test runs: `item` starts at Time (3) and `next` is its next value. */
		const run = (
			extra: TestNode[],
			edges: TestEdge[],
			definitions: Record<string, Definition>,
			iterations = 3,
		) => {
			const project = rootProject(
				[
					{ id: "time", type: "time" },
					{
						id: "z_in",
						type: "repeat-input",
						data: { pairedOutput: "z_out", values: { iterations } },
					},
					{
						id: "z_out",
						type: "repeat-output",
						data: { items: [{ id: "acc", label: "Acc", type: "f32" }] },
					},
					...extra,
				],
				[["time", "seconds", "z_in", "acc"], ...edges],
			);
			Object.assign(project.definitions, definitions);
			const frame = compiler(new GraphModel(project));
			const arg = frame.arg([], "z_out", "acc");
			const program: FrameProgram = frame.program();
			return arg === undefined ? undefined : evaluateFrame(program, ENV).arg(arg);
		};

		it("run a group's nodes in the loop", () => {
			expect(
				run(
					[group("g", "double")],
					[
						["z_in", "acc", "g", "a"],
						["g", "b", "z_out", "acc"],
					],
					{ double: double() },
				),
			).toBe(24);
		});

		it("run nodes of groups two deep in the loop", () => {
			const outer: Definition = {
				label: "Outer",
				inputs: [{ id: "a", label: "A", type: "f32" }],
				outputs: [{ id: "b", label: "B", type: "f32" }],
				nodes: [
					raw("gin", "group-input"),
					{
						...raw("inner", "node-group"),
						group: { definitionRef: "double", locked: false },
					},
					raw("gout", "group-output"),
				],
				edges: [edge(["gin", "a", "inner", "a"]), edge(["inner", "b", "gout", "b"])],
			};
			expect(
				run(
					[group("g", "outer")],
					[
						["z_in", "acc", "g", "a"],
						["g", "b", "z_out", "acc"],
					],
					{ double: double(), outer },
				),
			).toBe(24);
		});

		it("run a repeat zone in a group in the loop", () => {
			// The inner zone adds 1 twice, so the group adds 2 to what it's given.
			const inner: Definition = {
				label: "Inner",
				inputs: [{ id: "a", label: "A", type: "f32" }],
				outputs: [{ id: "b", label: "B", type: "f32" }],
				nodes: [
					raw("gin", "group-input"),
					raw("i_in", "repeat-input", {
						pairedOutput: "i_out",
						values: { iterations: 2 },
					}),
					raw("i_out", "repeat-output", {
						items: [{ id: "n", label: "N", type: "f32" }],
					}),
					raw("one", "declare", { values: { x: 1 } }),
					raw("add", "add"),
					raw("gout", "group-output"),
				],
				edges: [
					edge(["gin", "a", "i_in", "n"]),
					edge(["i_in", "n", "add", "operands"]),
					edge(["one", "value", "add", "operands"]),
					edge(["add", "result", "i_out", "n"]),
					edge(["i_out", "n", "gout", "b"]),
				],
			};
			expect(
				run(
					[group("g", "inner")],
					[
						["z_in", "acc", "g", "a"],
						["g", "b", "z_out", "acc"],
					],
					{ inner },
				),
			).toBe(3 + 3 * 2);
		});

		it("read a value from outside the loop in a group, and the zone's final value outside", () => {
			// a + k, with k read from Time outside the zone.
			const addK: Definition = {
				label: "Add K",
				inputs: [
					{ id: "a", label: "A", type: "f32" },
					{ id: "k", label: "K", type: "f32" },
				],
				outputs: [{ id: "b", label: "B", type: "f32" }],
				nodes: [raw("gin", "group-input"), raw("add", "add"), raw("gout", "group-output")],
				edges: [
					edge(["gin", "a", "add", "operands"]),
					edge(["gin", "k", "add", "operands"]),
					edge(["add", "result", "gout", "b"]),
				],
			};
			const nodes: TestNode[] = [
				group("g", "addK"),
				{ id: "one", type: "declare", data: { values: { x: 1 } } },
				{ id: "after", type: "add" },
			];
			const edges: TestEdge[] = [
				["z_in", "acc", "g", "a"],
				["time", "seconds", "g", "k"],
				["g", "b", "z_out", "acc"],
				["z_out", "acc", "after", "operands"],
				["one", "value", "after", "operands"],
			];
			const project = rootProject(
				[
					{ id: "time", type: "time" },
					{
						id: "z_in",
						type: "repeat-input",
						data: { pairedOutput: "z_out", values: { iterations: 3 } },
					},
					{
						id: "z_out",
						type: "repeat-output",
						data: { items: [{ id: "acc", label: "Acc", type: "f32" }] },
					},
					...nodes,
				],
				[["time", "seconds", "z_in", "acc"], ...edges],
			);
			project.definitions.addK = addK;
			const frame = compiler(new GraphModel(project));
			const arg = frame.arg([], "after", "result");
			expect(arg && evaluateFrame(frame.program(), ENV).arg(arg)).toBe(3 + 3 * 3 + 1);
		});

		it("run a node of only literals in the loop", () => {
			expect(
				run(
					[
						{ id: "two", type: "declare", data: { values: { x: 2 } } },
						{ id: "three", type: "declare", data: { values: { x: 3 } } },
						{ id: "six", type: "mul" },
						{ id: "next", type: "add" },
					],
					[
						["two", "value", "six", "operands"],
						["three", "value", "six", "operands"],
						["z_in", "acc", "next", "operands"],
						["six", "result", "next", "operands"],
						["next", "result", "z_out", "acc"],
					],
					{},
				),
			).toBe(3 + 3 * 6);
		});
	});

	describe("evaluated on demand", () => {
		it("computes only what a value needs", () => {
			const graph = model(
				[
					{ id: "img", type: "image", data: { asset: "wide" } },
					{ id: "size", type: "texture-size" },
					{ id: "x", type: "separate-vector" },
					{ id: "time", type: "time" },
					{ id: "two", type: "declare", data: { values: { x: 2 } } },
					{ id: "double", type: "mul" },
				],
				[
					["img", "texture", "size", "texture"],
					["size", "size", "x", "v"],
					["time", "seconds", "double", "operands"],
					["two", "value", "double", "operands"],
				],
				[IMAGE],
			);
			const frame = compiler(graph);
			const width = frame.arg([], "x", "x");
			const doubled = frame.arg([], "double", "result");
			const asked: string[] = [];
			const values = evaluateFrame(frame.program(), {
				...ENV,
				textureSize: (id) => {
					asked.push(id);
					throw new Error(`the size of ${id} was asked for`);
				},
			});
			expect(doubled && values.arg(doubled)).toBe(6);
			expect(asked).toEqual([]);
			expect(() => width && values.arg(width)).toThrow("the size of");
		});

		it("returns 0 for a step that reads itself", () => {
			const program: FrameProgram = {
				steps: [
					{ kind: "read", input: { ref: { step: 0, output: "value" }, type: "f32" } },
				],
			};
			expect(evaluateFrame(program, ENV).ref({ step: 0, output: "value" })).toEqual([0]);
		});
	});

	describe("converting what a step reads", () => {
		it("saturates a float read as an integer", () => {
			const graph = model(
				[
					{ id: "big", type: "declare", data: { values: { x: 3e9 } } },
					{ id: "time", type: "time" },
					{ id: "sum", type: "add", data: { types: { operands: "i32" } } },
				],
				[
					["big", "value", "sum", "operands"],
					["time", "seconds", "sum", "operands"],
				],
			);
			const frame = compiler(graph);
			const arg = frame.arg([], "sum", "result");
			// 2147483647 + 3 wraps: only the conversion from the float saturates.
			expect(arg && evaluateFrame(frame.program(), ENV).arg(arg)).toBe(-2147483646);
		});

		it("clamps an unlinked integer, as the shader's literal does", () => {
			const graph = model(
				[
					{
						id: "big",
						type: "declare",
						data: { types: { declare: "u32" }, values: { x: 5e9 } },
					},
					{ id: "time", type: "time" },
					{ id: "sum", type: "add", data: { types: { operands: "u32" } } },
				],
				[
					["big", "value", "sum", "operands"],
					["time", "frame", "sum", "operands"],
				],
			);
			const frame = compiler(graph);
			const arg = frame.arg([], "sum", "result");
			expect(arg && evaluateFrame(frame.program(), ENV).arg(arg)).toBe(
				(4294967295 + 7) >>> 0,
			);
		});
	});
});
