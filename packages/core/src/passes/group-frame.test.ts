import { describe, expect, it } from "bun:test";

import { generateRenderPlan } from "../codegen";
import { FrameValueAnalysis } from "../frame/analysis";
import type { GraphProject } from "../graph/document";
import { frameHandleIds } from "../graph/frame-handles";
import { GraphModel } from "../graph/model";
import {
	edge,
	libraryEntry,
	libraryHandle,
	rootProject,
	type TestEdge,
	type TestNode,
} from "../testing/graph";

const failure = (): never => {
	throw new Error("no node");
};

const flow = libraryEntry("std-optical-flow");
const input = (label: string) => libraryHandle(flow, "group-input", label);

function linked(source: TestNode[], from: [string, string], label: string) {
	const model = new GraphModel(
		rootProject(
			[
				...source,
				{ id: "g", type: "node-group", group: { definitionRef: flow.ref, locked: true } },
			],
			[[from[0], from[1], "g", input(label)]],
		),
	);
	const edge = model.root.edges[0];
	if (!edge) throw new Error("no link");
	return { model, link: new FrameValueAnalysis(model).link([], edge) };
}

describe("frame inputs of groups", () => {
	it("are the group inputs reaching an input that needs a frame value", () => {
		const model = new GraphModel(
			rootProject(
				[{ id: "g", type: "node-group", group: { definitionRef: flow.ref, locked: true } }],
				[],
			),
		);
		const ids = frameHandleIds(
			model.project.definitions.get(flow.ref) ?? model.root,
			model.project.definitions,
			(node) => model.resolveDescriptor(node),
		);
		expect(ids.has(input("Levels"))).toBe(true);
		// Only read in a pixel computation.
		expect(ids.has(input("Window"))).toBe(false);
		const descriptor = model.resolveDescriptor(
			model.root.nodesById.get("g") ?? model.root.nodes[0] ?? failure(),
		);
		expect(descriptor.inputs.find((i) => i.id === input("Levels"))?.frame).toBe(true);
		expect(descriptor.inputs.find((i) => i.id === input("Window"))?.frame).toBeUndefined();
	});

	it("make a link of a per-pixel value into one invalid", () => {
		const { link } = linked([{ id: "uv", type: "uv" }], ["uv", "uv"], "Levels");
		expect(link?.kind).toBe("invalid");
	});

	it("keep their stored value under an invalid link", () => {
		const plan = (edges: TestEdge[]) =>
			generateRenderPlan(
				new GraphModel(
					rootProject(
						[
							{ id: "uv", type: "uv" },
							{
								id: "g",
								type: "node-group",
								group: { definitionRef: flow.ref, locked: true },
								data: { values: { [input("Levels")]: 3 } },
							},
							{ id: "read", type: "sample-texture" },
						],
						[
							["g", libraryHandle(flow, "group-output", "Flow"), "read", "texture"],
							["read", "color", "out", "color"],
							...edges,
						],
					),
				),
			);
		expect(plan([["uv", "uv", "g", input("Levels")]])).toEqual(plan([]));
	});

	it("take a link of a frame value", () => {
		const { link } = linked([{ id: "t", type: "time" }], ["t", "seconds"], "Levels");
		expect(link).toEqual({ kind: "frame" });
	});

	it("leave a per-pixel link into an input only read per pixel alone", () => {
		const { link } = linked([{ id: "uv", type: "uv" }], ["uv", "uv"], "Window");
		expect(link).toBeUndefined();
	});
});

describe("frame inputs of nested groups", () => {
	const at = { x: 0, y: 0 };
	type Definition = GraphProject["definitions"][string];
	/** `a` sizes a Render Texture; `b` is only read per pixel. */
	const inner: Definition = {
		inputs: [
			{ id: "a", label: "A", type: "f32" },
			{ id: "b", label: "B", type: "f32" },
		],
		outputs: [{ id: "c", label: "C", type: "vec4f" }],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{
				id: "rt",
				type: "render-texture",
				data: { settings: { mode: "scale" } },
				position: at,
			},
			{ id: "gout", type: "group-output", data: {}, position: at },
		],
		edges: [edge(["gin", "a", "rt", "scale"]), edge(["gin", "b", "rt", "color"])],
	};
	/** `x` reaches `a` through an Add, `y` only `b`, `z` nothing. */
	const outer: Definition = {
		inputs: [
			{ id: "x", label: "X", type: "f32" },
			{ id: "y", label: "Y", type: "f32" },
			{ id: "z", label: "Z", type: "f32" },
		],
		outputs: [],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{ id: "one", type: "declare", data: { values: { x: 1 } }, position: at },
			{ id: "sum", type: "add", data: {}, position: at },
			{
				id: "in",
				type: "node-group",
				group: { definitionRef: "inner", locked: false },
				data: {},
				position: at,
			},
		],
		edges: [
			edge(["gin", "x", "sum", "operands"]),
			edge(["one", "value", "sum", "operands"]),
			edge(["sum", "result", "in", "a"]),
			edge(["gin", "y", "in", "b"]),
		],
	};

	it("follow a group input through nodes into a nested group's frame input", () => {
		const model = new GraphModel({
			definitions: {
				root: { nodes: [], edges: [] },
				inner,
				outer,
			},
		});
		const definitions = model.project.definitions;
		const doc = definitions.get("outer");
		if (!doc) throw new Error("no definition");
		expect([...frameHandleIds(doc, definitions, (n) => model.resolveDescriptor(n))]).toEqual([
			"x",
		]);
	});
});
