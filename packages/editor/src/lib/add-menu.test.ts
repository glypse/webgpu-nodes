import { describe, expect, it } from "vitest";

import { CATEGORY_LABELS, addMenuEntries, groupByHeading } from "./add-menu";
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
