import { describe, expect, it } from "bun:test";

import { addMenuEntries } from "../catalog/add-menu";
import { managerFor } from "../testing/graph";

describe("named reroutes", () => {
	const graph = () =>
		managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "scale", type: "reroute", data: { label: "Scale", hideLinks: true } },
				{ id: "plain", type: "reroute" },
				{ id: "s", type: "sin" },
			],
			[["t", "time", "scale", "in"]],
		);
	const entryOf = (g: ReturnType<typeof graph>) =>
		addMenuEntries(g).find((e) => e.kind === "link" && e.source === "scale");

	it("are listed in the add menu by name, other reroutes aren't", () => {
		const g = graph();
		const links = addMenuEntries(g).filter((e) => e.kind === "link");
		expect(links.map((e) => e.label)).toEqual(["Scale"]);
		expect(links[0]?.section).toEqual(["Named reroutes"]);
	});

	it("are linked to an input a link is dragged from, adding nothing", () => {
		const g = graph();
		const entry = entryOf(g);
		if (!entry) throw new Error("no entry");
		const pending = { nodeId: "s", handleId: "e", handleType: "target" as const };
		expect(g.connectableEntries([entry], pending)).toEqual([entry]);
		const count = g.root.nodes.length;
		g.addMenuEntryConnected(entry, { x: 0, y: 0 }, pending);
		expect(g.root.nodes).toHaveLength(count);
		expect(g.root.edgesByTarget.get("s")?.[0]?.source).toBe("scale");
	});

	it("feed a new reroute when added on their own", () => {
		const g = graph();
		const entry = entryOf(g);
		if (!entry) throw new Error("no entry");
		const id = g.addMenuEntry(entry, { x: 0, y: 0 }) ?? "";
		expect(g.root.nodesById.get(id)?.type).toBe("reroute");
		expect(g.root.edgesByTarget.get(id)?.[0]?.source).toBe("scale");
	});
});
