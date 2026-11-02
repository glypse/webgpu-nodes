import { describe, expect, it } from "bun:test";

import { managerFor } from "../testing/graph";
import { pairedOutputId } from "../zones";

describe("GraphModel layout", () => {
	it("lays a chain out left to right, keeping its top-left corner", async () => {
		const graph = managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
			],
			[
				["t", "seconds", "a", "e"],
				["a", "result", "b", "e"],
				["b", "result", "out", "color"],
			],
		);
		expect(await graph.layoutDocument()).toBe(true);
		const x = (id: string) => graph.root.nodesById.get(id)?.position.x ?? NaN;
		expect(x("t")).toBeLessThan(x("a"));
		expect(x("a")).toBeLessThan(x("b"));
		expect(x("b")).toBeLessThan(x("out"));
		const xs = graph.root.nodes.map((n) => n.position.x);
		const ys = graph.root.nodes.map((n) => n.position.y);
		expect(Math.min(...xs)).toBe(0);
		expect(Math.min(...ys)).toBe(0);
	});

	it("uses the front end's node sizes", async () => {
		const graph = managerFor(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
			],
			[["a", "result", "b", "e"]],
		);
		const geometry = (width: number) => ({
			width,
			height: 50,
			inputs: new Map([["e", 25]]),
			outputs: new Map([["result", 25]]),
		});
		await graph.layoutDocument(undefined, {
			nodeIds: ["a", "b"],
			measure: (_ref, node) => geometry(node.id === "a" ? 500 : 100),
			spacing: { betweenLayers: 10 },
		});
		const a = graph.root.nodesById.get("a")?.position.x ?? NaN;
		const b = graph.root.nodesById.get("b")?.position.x ?? NaN;
		expect(b - a).toBe(510);
	});

	it("moves only the given nodes", async () => {
		const graph = managerFor(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
			],
			[["a", "result", "b", "e"]],
		);
		const out = graph.root.nodesById.get("out");
		await graph.layoutDocument(undefined, { nodeIds: ["a", "b"] });
		expect(graph.root.nodesById.get("out")).toBe(out);
	});

	it("keeps a zone's nodes between its boundaries", async () => {
		const graph = managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "body", type: "sin" },
			],
			[],
		);
		const zoneId = graph.createRepeatZone({ x: 0, y: 0 });
		const input = graph.root.nodesById.get(zoneId ?? "");
		const outputId = input && pairedOutputId(input);
		if (!zoneId || !outputId) throw new Error("zone not created");
		const item = graph.getZoneItems(zoneId)[0]?.id ?? "";
		graph.connect({ source: zoneId, sourceHandle: item, target: "body", targetHandle: "e" });
		graph.connect({
			source: "body",
			sourceHandle: "result",
			target: outputId,
			targetHandle: item,
		});
		graph.connect({ source: "t", sourceHandle: "seconds", target: zoneId, targetHandle: item });
		expect(graph.activeZones.nodeZone.get("body")).toBe(zoneId);

		await graph.layoutDocument();
		const x = (id: string) => graph.root.nodesById.get(id)?.position.x ?? NaN;
		expect(x("t")).toBeLessThan(x(zoneId));
		expect(x(zoneId)).toBeLessThan(x("body"));
		expect(x("body")).toBeLessThan(x(outputId));
	});

	it("splits each output linked to several inputs at a reroute, once", async () => {
		const graph = managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "a", type: "sin" },
				{ id: "b", type: "cos" },
				{ id: "c", type: "add" },
			],
			[
				["t", "seconds", "a", "e"],
				["t", "seconds", "b", "e"],
				["a", "result", "c", "operands"],
				["b", "result", "c", "operands"],
				["c", "result", "out", "color"],
			],
		);
		await graph.layoutDocument();
		const fromTime = graph.root.edgesBySource.get("t") ?? [];
		expect(fromTime).toHaveLength(1);
		const reroute = fromTime[0]?.target ?? "";
		expect(graph.root.nodesById.get(reroute)?.type).toBe("reroute");
		expect(
			graph.root.edgesBySource
				.get(reroute)
				?.map((e) => e.target)
				.sort(),
		).toEqual(["a", "b"]);
		const count = graph.root.nodes.length;
		await graph.layoutDocument();
		expect(graph.root.nodes).toHaveLength(count);
	});
});
