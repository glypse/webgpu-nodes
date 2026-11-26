import { describe, expect, it } from "bun:test";

import type { GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import {
	edge,
	libraryEntry,
	libraryHandle,
	managerFor,
	rootProject,
	type TestEdge,
	type TestNode,
} from "../testing/graph";
import { FrameValueAnalysis } from "./analysis";

const at = { x: 0, y: 0 };

function model(nodes: TestNode[], edges: TestEdge[]) {
	return new GraphModel(rootProject(nodes, edges));
}

/** A group adding 1 to its input `a`. */
function increment(): GraphProject["definitions"][string] {
	return {
		label: "Increment",
		inputs: [{ id: "a", label: "A", type: "f32" }],
		outputs: [{ id: "b", label: "B", type: "f32" }],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{ id: "one", type: "declare", data: { values: { x: 1 } }, position: at },
			{ id: "sum", type: "add", data: {}, position: at },
			{ id: "gout", type: "group-output", data: {}, position: at },
		],
		edges: [
			edge(["gin", "a", "sum", "operands"]),
			edge(["one", "value", "sum", "operands"]),
			edge(["sum", "result", "gout", "b"]),
		],
	};
}

describe("frame values", () => {
	it("follow a Fallback to its default when its value is an input left unlinked", () => {
		const aspectUv = libraryEntry("std-aspect-uv");
		const out = libraryHandle(aspectUv, "group-output", "Coordinates");
		const coordinates = libraryHandle(aspectUv, "group-input", "Coordinates");
		const graph = managerFor(
			[
				{
					id: "a",
					type: "node-group",
					group: { definitionRef: aspectUv.ref, locked: true },
				},
				{
					id: "b",
					type: "node-group",
					group: { definitionRef: aspectUv.ref, locked: true },
				},
				{ id: "half", type: "declare", data: { types: { declare: "vec2f" } } },
			],
			[
				["a", out, "out", "color"],
				["half", "value", "b", coordinates],
			],
		);
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], "a", out)).toBe(false);
		expect(frame.isFrameValue([], "b", out)).toBe(true);
	});

	it("include a Repeat Passes zone's iteration, not its items", () => {
		const graph = model(
			[
				{
					id: "p_in",
					type: "pass-repeat-input",
					data: { pairedOutput: "p_out", values: { iterations: 2 } },
				},
				{
					id: "p_out",
					type: "pass-repeat-output",
					data: { items: [{ id: "acc", label: "Acc", type: "f32" }] },
				},
				{ id: "one", type: "declare", data: { values: { x: 1 } } },
				{ id: "next", type: "add" },
			],
			[
				["one", "value", "p_in", "acc"],
				["p_in", "iteration", "next", "operands"],
				["p_in", "acc", "next", "operands"],
				["next", "result", "p_out", "acc"],
			],
		);
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], "p_in", "iteration")).toBe(true);
		expect(frame.isFrameValue([], "p_in", "acc")).toBe(false);
		expect(frame.isFrameValue([], "next", "result")).toBe(false);
	});

	it("include maths on Time, unlinked values and canvas sizes", () => {
		const graph = model(
			[
				{ id: "time", type: "time" },
				{ id: "two", type: "declare", data: { values: { x: 2 } } },
				{ id: "double", type: "mul" },
				{ id: "size", type: "resolution" },
				{ id: "width", type: "separate-vector" },
			],
			[
				["time", "seconds", "double", "operands"],
				["two", "value", "double", "operands"],
				["size", "resolution", "width", "v"],
			],
		);
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], "double", "result")).toBe(true);
		expect(frame.isFrameValue([], "two", "value")).toBe(true);
		expect(frame.isFrameValue([], "width", "x")).toBe(true);
	});

	it("exclude what differs per pixel, saying why", () => {
		const graph = model(
			[
				{ id: "uv", type: "uv" },
				{ id: "x", type: "separate-vector" },
				{ id: "time", type: "time" },
				{ id: "sum", type: "add" },
			],
			[
				["uv", "uv", "x", "v"],
				["x", "x", "sum", "operands"],
				["time", "seconds", "sum", "operands"],
			],
		);
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], "x", "x")).toBe(false);
		expect(frame.isFrameValue([], "sum", "result")).toBe(false);
		expect(frame.reason([], "sum", "result")).toBe("UV is computed for each pixel.");
		expect(frame.isFrameInput([], "sum", "operands")).toBe(false);
	});

	it("exclude texture reads", () => {
		const graph = model(
			[
				{ id: "s", type: "sample-texture" },
				{ id: "a", type: "separate-vector" },
			],
			[["s", "color", "a", "v"]],
		);
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], "s", "color")).toBe(false);
		expect(frame.isFrameValue([], "a", "x")).toBe(false);
	});

	it("pass through groups as the inputs they're given", () => {
		const project = rootProject(
			[
				{ id: "time", type: "time" },
				{ id: "uv", type: "uv" },
				{ id: "x", type: "separate-vector" },
				{
					id: "a",
					type: "node-group",
					group: { definitionRef: "increment", locked: false },
				},
				{
					id: "b",
					type: "node-group",
					group: { definitionRef: "increment", locked: false },
				},
				{
					id: "c",
					type: "node-group",
					group: { definitionRef: "increment", locked: false },
				},
			],
			[
				["time", "seconds", "a", "a"],
				["uv", "uv", "x", "v"],
				["x", "x", "b", "a"],
			],
		);
		project.definitions.increment = increment();
		const frame = new GraphModel(project).frameValueAnalysis();
		expect(frame.isFrameValue([], "a", "b")).toBe(true);
		expect(frame.isFrameValue([], "b", "b")).toBe(false);
		// Unlinked, the group's input is an unlinked value.
		expect(frame.isFrameValue([], "c", "b")).toBe(true);
		expect(frame.isFrameValue(["a"], "sum", "result")).toBe(true);
		expect(frame.isFrameValue(["b"], "sum", "result")).toBe(false);
	});

	it("include a repeat zone over frame values, and what's in it", () => {
		const graph = new GraphModel(rootProject([{ id: "time", type: "time" }], []));
		const zone = graph.createRepeatZone(at) ?? "";
		const output = graph.root.nodesById.get(zone)?.data.pairedOutput ?? "";
		const item = graph.getZoneItems(zone)[0]?.id ?? "";
		const next = graph.addNode("mul", at) ?? "";
		graph.connect({ source: zone, sourceHandle: item, target: next, targetHandle: "operands" });
		graph.connect({
			source: zone,
			sourceHandle: "iteration",
			target: next,
			targetHandle: "operands",
		});
		graph.connect({ source: next, sourceHandle: "result", target: output, targetHandle: item });
		graph.connect({
			source: "time",
			sourceHandle: "seconds",
			target: zone,
			targetHandle: item,
		});
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], output, item)).toBe(true);
		expect(frame.isFrameValue([], next, "result")).toBe(true);
	});

	it("exclude a repeat zone with a value per pixel in it", () => {
		const graph = new GraphModel(rootProject([{ id: "uv", type: "uv" }], []));
		const zone = graph.createRepeatZone(at) ?? "";
		const output = graph.root.nodesById.get(zone)?.data.pairedOutput ?? "";
		const item = graph.getZoneItems(zone)[0]?.id ?? "";
		const x = graph.addNode("separate-vector", at) ?? "";
		const next = graph.addNode("mul", at) ?? "";
		graph.connect({ source: "uv", sourceHandle: "uv", target: x, targetHandle: "v" });
		graph.connect({ source: x, sourceHandle: "x", target: next, targetHandle: "operands" });
		graph.connect({
			source: zone,
			sourceHandle: "iteration",
			target: next,
			targetHandle: "operands",
		});
		graph.connect({ source: next, sourceHandle: "result", target: output, targetHandle: item });
		const frame = graph.frameValueAnalysis();
		expect(frame.isFrameValue([], output, item)).toBe(false);
		expect(frame.isFrameValue([], next, "result")).toBe(false);
		expect(frame.isFrameValue([], zone, "iteration")).toBe(false);
	});

	it("give a zone's values whichever of them is asked for first", () => {
		const build = () => {
			const graph = new GraphModel(rootProject([{ id: "time", type: "time" }], []));
			const zone = graph.createRepeatZone(at) ?? "";
			const output = graph.root.nodesById.get(zone)?.data.pairedOutput ?? "";
			const item = graph.getZoneItems(zone)[0]?.id ?? "";
			const next = graph.addNode("mul", at) ?? "";
			const link = (a: string, b: string, c: string, d: string) => {
				graph.connect({ source: a, sourceHandle: b, target: c, targetHandle: d });
			};
			link(zone, item, next, "operands");
			link(zone, "iteration", next, "operands");
			link(next, "result", output, item);
			link("time", "seconds", zone, item);
			return { frame: graph.frameValueAnalysis(), output, item, next };
		};
		const first = build();
		expect(first.frame.isFrameValue([], first.next, "result")).toBe(true);
		expect(first.frame.isFrameValue([], first.output, first.item)).toBe(true);
		const second = build();
		expect(second.frame.isFrameValue([], second.output, second.item)).toBe(true);
		expect(second.frame.isFrameValue([], second.next, "result")).toBe(true);
	});

	it("exclude what's in a nested zone that isn't a frame zone, whatever is asked first", () => {
		const nodes: TestNode[] = [
			{ id: "time", type: "time" },
			{ id: "uv", type: "uv" },
			{ id: "x", type: "separate-vector" },
			{
				id: "a_in",
				type: "repeat-input",
				data: { pairedOutput: "a_out", values: { iterations: 2 } },
			},
			{
				id: "a_out",
				type: "repeat-output",
				data: { items: [{ id: "acc", label: "Acc", type: "f32" }] },
			},
			{
				id: "b_in",
				type: "repeat-input",
				data: { pairedOutput: "b_out", values: { iterations: 2 } },
			},
			{
				id: "b_out",
				type: "repeat-output",
				data: {
					items: [
						{ id: "p", label: "P", type: "f32" },
						{ id: "q", label: "Q", type: "f32" },
					],
				},
			},
			{ id: "inc", type: "add" },
			{ id: "per_pixel", type: "add" },
			{ id: "one", type: "declare", data: { values: { x: 1 } } },
		];
		const edges: TestEdge[] = [
			["uv", "uv", "x", "v"],
			["time", "seconds", "a_in", "acc"],
			["a_in", "acc", "b_in", "p"],
			["time", "seconds", "b_in", "q"],
			// p goes up by one, a frame value if the zone were; q reads the pixel.
			["b_in", "p", "inc", "operands"],
			["one", "value", "inc", "operands"],
			["inc", "result", "b_out", "p"],
			["b_in", "q", "per_pixel", "operands"],
			["x", "x", "per_pixel", "operands"],
			["per_pixel", "result", "b_out", "q"],
			["b_out", "p", "a_out", "acc"],
		];
		const asks: [string, string][][] = [
			[
				["inc", "result"],
				["a_out", "acc"],
			],
			[
				["a_out", "acc"],
				["inc", "result"],
			],
		];
		for (const order of asks) {
			const frame = model(nodes, edges).frameValueAnalysis();
			for (const [node, handle] of order) {
				expect(frame.isFrameValue([], node, handle)).toBe(false);
			}
		}
	});

	it("are memoised until the graph changes", () => {
		const graph = model([{ id: "time", type: "time" }], []);
		const first = graph.frameValueAnalysis();
		expect(graph.frameValueAnalysis()).toBe(first);
		graph.addNode("add", at);
		expect(graph.frameValueAnalysis()).not.toBe(first);
	});
});

describe("frame value links", () => {
	/** `sin`'s input `e` needs a frame value, as sizes' inputs will. */
	function needing(graph: GraphModel): GraphModel {
		return Object.assign(Object.create(graph) as GraphModel, {
			resolveDescriptor: (node: Parameters<GraphModel["resolveDescriptor"]>[0]) => {
				const descriptor = graph.resolveDescriptor(node);
				return {
					...descriptor,
					inputs: descriptor.inputs.map((i) =>
						i.id === "e" ? { ...i, frame: true } : i,
					),
				};
			},
		});
	}

	it("tell frame values from per-pixel ones, and refuse those into inputs needing a frame value", () => {
		const graph = model(
			[
				{ id: "time", type: "time" },
				{ id: "uv", type: "uv" },
				{ id: "x", type: "separate-vector" },
				{ id: "now", type: "sin" },
				{ id: "here", type: "sin" },
			],
			[
				["time", "seconds", "now", "e"],
				["uv", "uv", "x", "v"],
				["x", "x", "here", "e"],
			],
		);
		const frame = new FrameValueAnalysis(needing(graph), graph.passAnalysis().sources);
		const link = (id: string) => {
			const found = graph.root.edges.find((e) => e.id === id);
			return found && frame.link([], found);
		};
		expect(link("time.seconds->now.e")).toEqual({ kind: "frame" });
		expect(link("x.x->here.e")).toEqual({
			kind: "invalid",
			reason: "Needs a value that's the same for the whole frame: UV is computed for each pixel.",
		});
		// Without the requirement, a per-pixel value links as it always did.
		const plain = graph.frameValueAnalysis();
		expect(
			plain.link([], graph.root.edges.find((e) => e.target === "here") ?? ({} as never)),
		).toBeUndefined();
	});
});
