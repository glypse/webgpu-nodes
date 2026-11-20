import { describe, expect, it } from "bun:test";

import * as v from "valibot";

import { type Asset, AssetSchema, frameInterval } from "../assets/assets";
import { generateShader } from "../codegen";
import { evaluateFrame, FrameCompiler } from "../frame/program";
import { GraphModel } from "../graph/model";
import { rootProject, type TestEdge, type TestNode } from "../testing/graph";

const video = (id: string, frameRate = 25): Asset => ({
	kind: "video",
	id,
	name: id,
	file: `assets/videos/${id}.mp4`,
	mime: "video/mp4",
	bytes: 1,
	hash: "0".repeat(64),
	width: 64,
	height: 32,
	duration: 2,
	frameRate,
});

function model(nodes: TestNode[], edges: TestEdge[]) {
	return new GraphModel({ ...rootProject(nodes, edges), assets: [video("v"), video("w", 24)] });
}

describe("video frame rate", () => {
	it("is kept by video assets", () => {
		expect(v.safeParse(AssetSchema, video("v")).success).toBe(true);
		expect(v.safeParse(AssetSchema, { ...video("v"), frameRate: undefined }).success).toBe(
			false,
		);
		expect(frameInterval(video("v", 25))).toBe(Math.fround(0.04));
		expect(frameInterval(video("v", 0))).toBe(0);
		expect(frameInterval(undefined)).toBe(0);
	});

	it("gives a Video node's frame interval as a value the same for the whole frame", () => {
		const graph = model(
			[{ id: "vid", type: "video", data: { asset: "w" } }],
			[["vid", "interval", "out", "color"]],
		);
		const analysis = graph.frameValueAnalysis();
		expect(analysis.isFrameValue([], "vid", "interval")).toBe(true);
		expect(analysis.isFrameValue([], "vid", "duration")).toBe(true);
		expect(analysis.isFrameValue([], "vid", "size")).toBe(false);
		const frame = new FrameCompiler(graph, analysis, graph.passAnalysis().sources);
		const arg = frame.arg([], "vid", "interval");
		const values = evaluateFrame(frame.program(), {
			time: 0,
			delta: 0,
			frame: 0,
			canvas: { width: 8, height: 8 },
			passSize: { width: 8, height: 8 },
		});
		expect(arg && values.arg(arg)).toBe(Math.fround(1 / 24));
	});

	it("compiles the frame interval into a shader", () => {
		const graph = model(
			[{ id: "vid", type: "video", data: { asset: "v" } }],
			[["vid", "interval", "out", "color"]],
		);
		expect(generateShader(graph).shader).toContain("f32(0.0399999");
	});
});
