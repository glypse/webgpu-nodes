import { describe, expect, it } from "bun:test";

import { managerFor, shaderFor } from "../testing/graph";
import { analyzeFrames, LAYOUT_FRAME } from "./analysis";
import { FRAME_PADDING, frameRects } from "./geometry";

const frame = (id: string, inFrame?: string) => ({
	id,
	type: LAYOUT_FRAME,
	...(inFrame ? { frame: inFrame } : {}),
});

describe("analyzeFrames", () => {
	it("nests frames and collects what they hold", () => {
		const { frames, frameOf } = analyzeFrames([
			frame("outer"),
			frame("inner", "outer"),
			{ id: "a", type: "sin", frame: "inner" },
			{ id: "b", type: "sin", frame: "outer" },
		]);
		expect(frames.get("inner")?.parent).toBe("outer");
		expect(frames.get("inner")?.depth).toBe(1);
		expect(frames.get("outer")?.children).toEqual(["inner", "b"]);
		expect([...(frames.get("outer")?.descendants ?? [])].sort()).toEqual(["a", "b", "inner"]);
		expect(frameOf.get("a")).toBe("inner");
	});

	it("ignores frames that aren't there, and takes frames on a cycle out of theirs", () => {
		const { frameOf } = analyzeFrames([
			{ id: "a", type: "sin", frame: "gone" },
			{ id: "b", type: "sin", frame: "x" },
			frame("x", "y"),
			frame("y", "x"),
		]);
		expect(frameOf.has("a")).toBe(false);
		expect(frameOf.get("b")).toBe("x");
		expect(frameOf.has("x")).toBe(false);
		expect(frameOf.has("y")).toBe(false);
	});
});

describe("frameRects", () => {
	it("goes around what a frame holds, under its header", () => {
		const nodes = [
			{ ...frame("f"), position: { x: 0, y: 0 } },
			{ id: "a", type: "sin", frame: "f", position: { x: 100, y: 100 } },
			{ id: "b", type: "sin", frame: "f", position: { x: 300, y: 200 } },
		];
		const rects = frameRects(
			nodes,
			analyzeFrames(nodes),
			(n) => ({ ...n.position, width: 50, height: 40 }),
			() => ({ width: 80, height: 30 }),
		);
		expect(rects.get("f")).toEqual({
			x: 100 - FRAME_PADDING,
			y: 100 - FRAME_PADDING - 30,
			width: 250 + 2 * FRAME_PADDING,
			height: 140 + 2 * FRAME_PADDING + 30,
		});
	});
});

describe("GraphModel frames", () => {
	it("leaves frames out of the shader", () => {
		const framed = shaderFor(
			[
				{ id: "f", type: LAYOUT_FRAME },
				{ id: "t", type: "time", frame: "f" },
			],
			[["t", "time", "out", "color"]],
		);
		expect(framed).toBe(
			shaderFor([{ id: "t", type: "time" }], [["t", "time", "out", "color"]]),
		);
	});

	it("frames nodes in the frame they share, and takes them out one frame at a time", () => {
		const graph = managerFor(
			[
				{ id: "outer", type: LAYOUT_FRAME },
				{ id: "a", type: "sin", frame: "outer" },
				{ id: "b", type: "sin", frame: "outer" },
			],
			[],
		);
		const id = graph.frameNodes(["a", "b"]) ?? "";
		const analysis = () => graph.frameAnalysis(graph.root);
		expect(analysis().frameOf.get(id)).toBe("outer");
		expect(analysis().frameOf.get("a")).toBe(id);
		expect(graph.selectedNodeIds).toEqual([id]);

		expect(graph.removeFromFrame(["a"])).toBe(true);
		expect(analysis().frameOf.get("a")).toBe("outer");
		expect(graph.removeFromFrame(["a"])).toBe(true);
		expect(analysis().frameOf.has("a")).toBe(false);
		expect(graph.removeFromFrame(["a"])).toBe(false);
	});

	it("never puts a frame in itself or in a frame it holds", () => {
		const graph = managerFor(
			[
				{ id: "outer", type: LAYOUT_FRAME },
				{ id: "inner", type: LAYOUT_FRAME, frame: "outer" },
				{ id: "a", type: "sin" },
			],
			[],
		);
		expect(graph.setNodesFrame(["outer"], "inner")).toBe(false);
		expect(graph.setNodesFrame(["outer"], "outer")).toBe(false);
		expect(graph.setNodesFrame(["a", "outer"], "inner")).toBe(true);
		expect(graph.frameAnalysis(graph.root).frameOf.get("a")).toBe("inner");
		expect(graph.setNodesFrame(["a"], null)).toBe(true);
		expect(graph.root.nodesById.get("a")?.frame).toBeUndefined();
	});

	it("keeps what a deleted frame held, in the frame around it", () => {
		const graph = managerFor(
			[
				{ id: "outer", type: LAYOUT_FRAME },
				{ id: "inner", type: LAYOUT_FRAME, frame: "outer" },
				{ id: "a", type: "sin", frame: "inner" },
			],
			[],
		);
		graph.deleteNodes(["inner"]);
		expect(graph.root.nodesById.get("a")?.frame).toBe("outer");
	});

	it("copies a frame with what it holds", () => {
		const graph = managerFor(
			[
				{ id: "f", type: LAYOUT_FRAME },
				{ id: "a", type: "sin", frame: "f" },
				{ id: "b", type: "sin" },
			],
			[],
		);
		const copied = graph.duplicateNodes(["f"]);
		expect(copied).toHaveLength(2);
		const copy = copied.map((id) => graph.root.nodesById.get(id));
		const frameCopy = copy.find((n) => n?.type === LAYOUT_FRAME);
		expect(copy.find((n) => n?.type === "sin")?.frame).toBe(frameCopy?.id);
	});

	it("groups a frame with what it holds, the group node staying in the frame around them", () => {
		const graph = managerFor(
			[
				{ id: "outer", type: LAYOUT_FRAME },
				{ id: "f", type: LAYOUT_FRAME, frame: "outer" },
				{ id: "a", type: "sin", frame: "f" },
				{ id: "b", type: "sin", frame: "outer" },
			],
			[["a", "result", "b", "e"]],
		);
		graph.groupSelection(new Set(["f"]));
		const group = graph.root.nodes.find((n) => n.type === "node-group");
		expect(group?.frame).toBe("outer");
		const inner = graph.project.definitions.get(group?.group?.definitionRef ?? "");
		expect(inner?.nodesById.get("a")?.frame).toBe("f");
		expect(inner?.nodesById.get("f")?.frame).toBeUndefined();
	});

	it("lays a frame's nodes out together, the frame around them", async () => {
		const graph = managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "f", type: LAYOUT_FRAME },
				{ id: "a", type: "sin", frame: "f" },
				{ id: "b", type: "cos", frame: "f" },
				{ id: "c", type: "add" },
			],
			[
				["t", "time", "a", "e"],
				["t", "time", "b", "e"],
				["a", "result", "c", "operands"],
				["b", "result", "c", "operands"],
				["c", "result", "out", "color"],
			],
		);
		await graph.layoutDocument();
		const at = (id: string) => graph.root.nodesById.get(id)?.position ?? { x: NaN, y: NaN };
		expect(at("f").x).toBeLessThan(at("a").x);
		expect(at("f").y).toBeLessThan(Math.min(at("a").y, at("b").y));
		expect(at("t").x).toBeLessThan(at("f").x);
	});
});
