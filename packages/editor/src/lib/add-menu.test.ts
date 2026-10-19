import { describe, expect, it } from "vitest";

import { CATEGORY_LABELS, addMenuEntries, groupByHeading } from "./add-menu";
import type { PendingConnection } from "./graph-state.svelte";
import { managerFor } from "./testing/graph";

describe("add menu entries", () => {
	it("lists visible nodes, the repeat zone and library groups, by heading", () => {
		const entries = addMenuEntries(managerFor([], []));
		const keys = entries.map((e) => e.key);
		expect(keys).toContain("zone:repeat");
		expect(keys).toContain("node:add");
		expect(keys).toContain("group:std-dummy");
		expect(keys).not.toContain("node:frag-output");
		expect(keys.some((k) => k.includes("repeat-input"))).toBe(false);

		const headings = groupByHeading(entries).map((g) => g.heading);
		const known = Object.values(CATEGORY_LABELS);
		expect(headings).toEqual(known.filter((h) => headings.includes(h)));
	});

	it("offers to delete unused user groups only", () => {
		const graph = managerFor([], []);
		const groupId = graph.createGroup({ x: 0, y: 0 });
		const used = addMenuEntries(graph).find((e) => e.heading === "Groups");
		expect(used?.deletable).toBe(false);

		graph.root.nodes = graph.root.nodes.filter((n) => n.id !== groupId);
		graph.root.nodesById.delete(groupId ?? "");
		const unused = addMenuEntries(graph).find((e) => e.heading === "Groups");
		expect(unused?.deletable).toBe(true);
	});

	it("creates what each entry stands for", () => {
		const graph = managerFor([], []);
		const entries = addMenuEntries(graph);
		const byKey = (key: string) => {
			const entry = entries.find((e) => e.key === key);
			if (!entry) throw new Error(`missing ${key}`);
			return entry;
		};
		const at = { x: 0, y: 0 };
		const sin = graph.addMenuEntry(byKey("node:sin"), at);
		const zone = graph.addMenuEntry(byKey("zone:repeat"), at);
		const library = graph.addMenuEntry(byKey("group:std-dummy"), at);
		const fresh = graph.addMenuEntry(byKey("node:node-group"), at);
		const types = [sin, zone, library, fresh].map(
			(id) => graph.root.nodesById.get(id ?? "")?.type,
		);
		expect(types).toEqual(["sin", "repeat-input", "node-group", "node-group"]);
		expect(graph.activeZones.zones.size).toBe(1);
	});
});

describe("adding from a dropped link", () => {
	const keysFor = (graph: ReturnType<typeof managerFor>, pending: PendingConnection) =>
		addMenuEntries(graph)
			.filter((e) => graph.entryHandleFor(e, pending) !== undefined)
			.map((e) => e.key);

	it("only offers nodes that can take the dragged value", () => {
		const graph = managerFor([{ id: "uv", type: "uv" }], []);
		const fromUv: PendingConnection = { nodeId: "uv", handleId: "uv", handleType: "source" };
		const keys = keysFor(graph, fromUv);
		expect(keys).toEqual(expect.arrayContaining(["node:sin", "node:cross", "zone:repeat"]));
		// Declare takes scalars only; a fresh empty group has nothing to plug into.
		expect(keys).not.toContain("node:declare");
		expect(keys).not.toContain("node:node-group");
		expect(keys).not.toContain("node:time");
	});

	it("only offers nodes producing what the input accepts when dragged from an input", () => {
		const graph = managerFor([], []);
		const zoneId = graph.createRepeatZone({ x: 0, y: 0 }) ?? "";
		const toIterations: PendingConnection = {
			nodeId: zoneId,
			handleId: "iterations",
			handleType: "target",
		};
		const keys = keysFor(graph, toIterations);
		expect(keys).toEqual(expect.arrayContaining(["node:time", "node:dot", "node:add"]));
		expect(keys).not.toContain("node:uv");
		expect(keys).not.toContain("node:cross");
	});

	it("prefers handles of the same scalar kind", () => {
		const graph = managerFor([{ id: "t", type: "time" }], []);
		const fromTime: PendingConnection = { nodeId: "t", handleId: "time", handleType: "source" };
		const switchEntry = addMenuEntries(graph).find((e) => e.key === "node:switch");
		if (!switchEntry) throw new Error("missing switch");
		expect(graph.entryHandleFor(switchEntry, fromTime)).toBe("false");
	});

	it("creates the node and links it", () => {
		const graph = managerFor([{ id: "t", type: "time" }], []);
		const entries = addMenuEntries(graph);
		const sinEntry = entries.find((e) => e.key === "node:sin");
		const zoneEntry = entries.find((e) => e.key === "zone:repeat");
		if (!sinEntry || !zoneEntry) throw new Error("missing entries");

		const fromTime: PendingConnection = { nodeId: "t", handleId: "time", handleType: "source" };
		const sin = graph.addMenuEntryConnected(sinEntry, { x: 0, y: 0 }, fromTime);
		expect(graph.root.edges).toContainEqual(
			expect.objectContaining({ source: "t", target: sin, targetHandle: "e" }),
		);

		// Upstream of the output: a zone whose output gets a new item feeding it.
		const toColor: PendingConnection = {
			nodeId: "out",
			handleId: "color",
			handleType: "target",
		};
		const zone = graph.addMenuEntryConnected(zoneEntry, { x: 0, y: 0 }, toColor) ?? "";
		const items = graph.getZoneItems(zone);
		expect(items.map((i) => i.type)).toEqual(["f32", "vec4f"]);
		expect(graph.root.edges.find((e) => e.target === "out")?.sourceHandle).toBe(items[1]?.id);
	});

	it("keeps one link per non-variadic input but stacks variadic ones", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "time" },
				{ id: "b", type: "delta" },
				{ id: "s", type: "sin" },
				{ id: "sum", type: "add" },
			],
			[],
		);
		graph.connect({ source: "a", sourceHandle: "time", target: "s", targetHandle: "e" });
		graph.connect({ source: "b", sourceHandle: "delta", target: "s", targetHandle: "e" });
		expect(graph.root.edges.filter((e) => e.target === "s").map((e) => e.source)).toEqual([
			"b",
		]);
		graph.connect({
			source: "a",
			sourceHandle: "time",
			target: "sum",
			targetHandle: "operands",
		});
		graph.connect({
			source: "b",
			sourceHandle: "delta",
			target: "sum",
			targetHandle: "operands",
		});
		expect(graph.root.edges.filter((e) => e.target === "sum")).toHaveLength(2);
	});
});
