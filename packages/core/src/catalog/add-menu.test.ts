import { describe, expect, it } from "bun:test";

import type { PendingConnection } from "../graph/model";
import { containing } from "../testing/expect";
import { managerFor } from "../testing/graph";
import {
	addMenuEntries,
	CATEGORY_LABELS,
	groupByHeading,
	groupResults,
	highlightParts,
	searchEntries,
} from "./add-menu";

describe("add menu entries", () => {
	it("lists visible nodes, the repeat zone and library groups, by heading", () => {
		const entries = addMenuEntries(managerFor([], []));
		const keys = entries.map((e) => e.key);
		expect(keys).toContain("zone:repeat");
		expect(keys).toContain("node:add");
		expect(keys).toContain("group:std-aspect-uv");
		expect(keys).not.toContain("node:frag-output");
		expect(keys).not.toContain("node:test-invalid-wgsl");
		expect(keys.some((k) => k.includes("repeat-input"))).toBe(false);

		const headings = groupByHeading(entries).map((g) => g.heading);
		const known = Object.values(CATEGORY_LABELS);
		expect(headings).toEqual(known.filter((h) => headings.includes(h)));
	});

	it("lists developer-tool nodes with developer tools only", () => {
		const keys = addMenuEntries(managerFor([], []), { devTools: true }).map((e) => e.key);
		expect(keys).toContain("node:test-invalid-wgsl");
		expect(keys).toContain("node:add");
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
		const library = graph.addMenuEntry(byKey("group:std-aspect-uv"), at);
		const fresh = graph.addMenuEntry(byKey("node:node-group"), at);
		const types = [sin, zone, library, fresh].map(
			(id) => graph.root.nodesById.get(id ?? "")?.type,
		);
		expect(types).toEqual(["sin", "repeat-input", "node-group", "node-group"]);
		expect(graph.activeZones.zones.size).toBe(1);
	});
});

describe("fuzzy search", () => {
	const graph = managerFor([], []);
	const entries = addMenuEntries(graph);
	const labels = (query: string) => searchEntries(entries, query).map((r) => r.entry.label);

	it("finds names holding the query's letters in order", () => {
		expect(labels("smstp")).toContain("Smoothstep");
		expect(labels("vor tex")).toContain("Voronoi Texture");
		expect(labels("smoth")).toContain("Smoothstep");
		expect(labels("multipyl")).toContain("Multiply");
		expect(labels("smoothstep")[0]).toBe("Smoothstep");
	});

	it("finds variants by their configuration, and creates them so", () => {
		const [first] = searchEntries(entries, "value vec2i");
		if (!first) throw new Error("no result");
		expect(first.entry.label).toBe("Declare vec2i");
		expect(first.alias).toBe("Value");
		const declare = graph.addMenuEntry(first.entry, { x: 0, y: 0 }) ?? "";
		expect(graph.resolveNodeOutputType(declare)).toBe("vec2i");

		expect(first.aliasRanges).toEqual([0, 5]);
		expect(highlightParts(first.entry.label, first.labelRanges)).toEqual([
			{ text: "Declare ", matched: false },
			{ text: "vec2i", matched: true },
		]);

		expect(labels("declare")).not.toContain("Declare f32");
		expect(labels("compare less")).toContain("Compare Less Than");
		expect(labels("add vec2f")[0]).toBe("Add vec2f");
		expect(labels("add 2")).toContainValues(["Add vec2f", "Add vec2i"]);
		const [addVec3] = searchEntries(entries, "add vec3f");
		if (!addVec3) throw new Error("no result");
		const add = graph.addMenuEntry(addVec3.entry, { x: 0, y: 0 }) ?? "";
		expect(graph.typeChoice(add)?.forced).toBe("vec3f");
	});

	it("picks several options at once", () => {
		const [first] = searchEntries(entries, "vorn man vec3");
		if (!first) throw new Error("no result");
		expect(first.entry.label).toBe("Fractal Voronoi vec3f Manhattan");
		const voronoi = graph.addMenuEntry(first.entry, { x: 0, y: 0 }) ?? "";
		const data = graph.root.nodesById.get(voronoi)?.data;
		expect(Object.values(data?.values ?? {})).toEqual([1]);
		expect(Object.values(data?.types ?? {})).toEqual(["vec3f"]);
		expect(labels("value vec2i 3d")).not.toContain("Declare vec2i 3D");
	});

	it("only picks options the query matches letters of", () => {
		const results = searchEntries(entries, "fractal voronoi", () => false);
		expect(results.map((r) => r.entry.label)).toContain("Fractal Voronoi");
		expect(labels("fractal voronoi")).not.toContain("Fractal Voronoi Euclidean");
		expect(searchEntries(entries, "vorn man vec3", () => false)).toEqual([]);
	});

	it("lists a variant creating what its entry does once, by the variant's name", () => {
		const results = searchEntries(entries, "less than");
		const compares = results.filter((r) => r.entry.type === "compare");
		expect(compares.map((r) => [r.entry.label, r.alias])).toEqual([
			["Compare Less Than", undefined],
			["Compare Less Than or Equal", undefined],
		]);
		expect(labels("voronoi texture vec3f")).toContain("Voronoi Texture vec3f");
	});
});

describe("adding from a dropped link", () => {
	const keysFor = (graph: ReturnType<typeof managerFor>, pending: PendingConnection) =>
		graph.connectableEntries(addMenuEntries(graph), pending).map((e) => e.key);

	it("only offers nodes that can take the dragged value", () => {
		const graph = managerFor([{ id: "uv", type: "uv" }], []);
		const fromUv: PendingConnection = { nodeId: "uv", handleId: "uv", handleType: "source" };
		const keys = keysFor(graph, fromUv);
		expect(keys).toContainValues(["node:sin", "node:cross", "zone:repeat"]);
		// Declare takes scalars only; a fresh empty group has nothing to plug into.
		expect(keys.some((k) => k.startsWith("node:declare"))).toBe(false);
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
		expect(keys).toContainValues(["node:time", "node:dot", "node:add"]);
		expect(keys).not.toContain("node:uv");
		expect(keys).not.toContain("node:cross");
	});

	it("offers a Declare of the input's type to feed it", () => {
		const graph = managerFor([], []);
		const toColor: PendingConnection = {
			nodeId: "out",
			handleId: "color",
			handleType: "target",
		};
		const entries = graph.connectableEntries(addMenuEntries(graph), toColor);
		const declares = entries.filter((e) => e.type === "declare");
		expect(declares.map((e) => e.label)).toEqual(["Declare vec4f"]);

		const [vec4] = declares;
		if (!vec4) throw new Error("missing Declare vec4f");
		const declare = graph.addMenuEntryConnected(vec4, { x: 0, y: 0 }, toColor) ?? "";
		expect(graph.resolveNodeOutputType(declare)).toBe("vec4f");
		expect(graph.root.edges).toContainEqual(
			containing({ source: declare, target: "out", targetHandle: "color" }),
		);
	});

	it("offers Declares of vectors of the dragged scalar to combine it", () => {
		const graph = managerFor([{ id: "t", type: "time" }], []);
		const fromTime: PendingConnection = { nodeId: "t", handleId: "time", handleType: "source" };
		const entries = graph.connectableEntries(addMenuEntries(graph), fromTime);
		const declares = entries.filter((e) => e.type === "declare");
		expect(declares.map((e) => e.data?.types?.declare)).toEqual(["vec2f", "vec3f", "vec4f"]);

		const vec3 = declares.find((e) => e.data?.types?.declare === "vec3f");
		if (!vec3) throw new Error("missing Declare vec3f");
		const declare = graph.addMenuEntryConnected(vec3, { x: 0, y: 0 }, fromTime) ?? "";
		expect(graph.resolveNodeOutputType(declare)).toBe("vec3f");
		expect(graph.root.edges).toContainEqual(
			containing({ source: "t", target: declare, targetHandle: "x" }),
		);
	});

	it("searches typed variants by their type and aliases", () => {
		const graph = managerFor([], []);
		const toColor: PendingConnection = {
			nodeId: "out",
			handleId: "color",
			handleType: "target",
		};
		const entries = graph.connectableEntries(addMenuEntries(graph), toColor);
		const [first] = searchEntries(entries, "combine vector");
		expect(first?.entry.label).toBe("Declare vec4f");
		expect(first?.alias).toBe("Combine Vector");
		const vec4 = searchEntries(entries, "vec4").map((r) => r.entry.label);
		expect(vec4).toContain("Declare vec4f");
		expect(vec4).not.toContain("Declare vec3f");
		expect(searchEntries(entries, "rgba").map((r) => r.entry.label)).toContain("Color");
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
			containing({ source: "t", target: sin, targetHandle: "e" }),
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

describe("searchEntries", () => {
	const entries = addMenuEntries(managerFor([], []));
	const labels = (query: string) => searchEntries(entries, query).map((r) => r.entry.label);

	it("ranks label prefixes first, then word prefixes, then substrings", () => {
		const result = labels("to");
		expect(result.slice(0, 4).every((l) => l.startsWith("To "))).toBe(true);
		expect(labels("tan")[0]).toBe("Tangent");
		expect(labels("tangent")).toContain("Arc Tangent");
	});

	it("matches headings and requires every word", () => {
		expect(labels("logic not")[0]).toBe("Not");
		expect(labels("integer not")).toEqual(["Bitwise Not"]);
		expect(labels("zones")).toContain("Repeat Zone");
		expect(labels("   ")).toEqual([]);
		expect(labels("no such node")).toEqual([]);
	});

	it("finds entries by alias, saying which one matched", () => {
		const [first] = searchEntries(entries, "combine xyz");
		expect(first?.entry.key).toBe("node:declare");
		expect(first?.alias).toBe("Combine XYZ");
		expect(labels("map range")[0]).toBe("Remap");
		expect(labels("loop")).toContain("Repeat Zone");
		expect(labels("aspect ratio")).toContain("Aspect UV");
	});

	it("ranks label matches above alias matches, without reporting an alias", () => {
		const results = searchEntries(entries, "dot");
		expect(results[0]?.entry.label).toBe("Dot Product");
		expect(results[0]?.alias).toBeUndefined();
		expect(results.find((r) => r.entry.label === "Reroute")?.alias).toBe("Dot");
	});
});

describe("add menu sections", () => {
	const entries = addMenuEntries(managerFor([], []));

	it("nests entries in their sections under their heading", () => {
		const texture = groupByHeading(entries).find((g) => g.heading === CATEGORY_LABELS.texture);
		expect(texture?.entries.map((e) => e.label)).toEqual(["Fractal Voronoi", "Fractal Noise"]);
		const helpers = texture?.sections.find((s) => s.name === "Helpers");
		expect(helpers?.entries.map((e) => e.label)).toContain("Hash");
		expect(helpers?.sections.map((s) => s.name)).toEqual(["Voronoi", "OpenSimplex"]);
		expect(helpers?.sections[0]?.entries.map((e) => e.label)).toContain("Voronoi Texture");
	});

	it("lists search results of a search section after the main ones, flattened", () => {
		const groups = groupResults(searchEntries(entries, "voronoi"));
		expect(groups.map((g) => g.section)).toEqual([undefined, "Helpers"]);
		expect(groups[0]?.results.map((r) => r.entry.label)).toEqual(["Fractal Voronoi"]);
		expect(groups[1]?.results.map((r) => r.entry.label)).toContainValues([
			"Voronoi Texture",
			"Voronoi Point",
			"Voronoi Distance",
		]);
	});
});
