import { describe, expect, it } from "bun:test";

import { defaultScene } from "../scenes";
import { GraphModel } from "./model";

async function loaded(): Promise<GraphModel> {
	const graph = new GraphModel();
	expect((await graph.loadProject(structuredClone(defaultScene))).ok).toBe(true);
	return graph;
}

describe("analyses kept through UI-only edits", () => {
	it("selecting a link keeps the pass analysis", async () => {
		const graph = await loaded();
		const passes = graph.passAnalysis();
		graph.edges = graph.edges.map((e, i) => (i === 0 ? { ...e, selected: true } : e));
		expect(graph.passAnalysis()).toBe(passes);
		expect(graph.edges[0]?.selected).toBe(true);
	});

	it("rewiring a link still rebuilds them", async () => {
		const graph = await loaded();
		const passes = graph.passAnalysis();
		graph.edges = graph.edges.slice(1);
		expect(graph.passAnalysis()).not.toBe(passes);
	});

	it("moving a node keeps the zone and frame analyses", async () => {
		const graph = await loaded();
		const doc = graph.activeDocument;
		const zones = graph.zoneAnalysis(doc);
		const frames = graph.frameAnalysis(doc);
		graph.nodes = graph.nodes.map((n, i) =>
			i === 0 ? { ...n, position: { x: n.position.x + 7, y: n.position.y } } : n,
		);
		expect(graph.zoneAnalysis(doc)).toBe(zones);
		expect(graph.frameAnalysis(doc)).toBe(frames);
	});

	it("removing a node or a link recomputes the zone analysis", async () => {
		const graph = await loaded();
		const doc = graph.activeDocument;
		const zones = graph.zoneAnalysis(doc);
		graph.edges = graph.edges.slice(1);
		expect(graph.zoneAnalysis(doc)).not.toBe(zones);
	});
});
