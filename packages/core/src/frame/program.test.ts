import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { FLOAT_TYPES } from "../types";
import { evaluateFrame, FrameCompiler, type FrameEnv } from "./program";

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
		expect(frame.compile([], "sq", "b")?.input).toEqual({ literal: [9, 16] });
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
});
