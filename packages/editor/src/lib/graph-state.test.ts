import { describe, expect, it } from "vitest";

import { generateShader } from "./codegen";
import { managerFor } from "./testing/graph";
import { nagaBin, validateFragment } from "./testing/wgsl";
import { NEW_ITEM_HANDLE, pairedOutputId } from "./zones";

/** A manager holding one fresh repeat zone, plus a few loose nodes. */
function setup() {
	const graph = managerFor(
		[
			{ id: "t", type: "time" },
			{ id: "s", type: "sin" },
			{ id: "uv", type: "uv" },
		],
		[],
	);
	const zoneId = graph.createRepeatZone({ x: 0, y: 0 });
	if (!zoneId) throw new Error("zone not created");
	const input = graph.root.nodesById.get(zoneId);
	const outputId = input ? pairedOutputId(input) : undefined;
	if (!outputId) throw new Error("zone not paired");
	const item = graph.getZoneItems(zoneId)[0];
	if (!item) throw new Error("zone has no item");
	return { graph, zoneId, outputId, item };
}

const connection = (
	source: string,
	sourceHandle: string,
	target: string,
	targetHandle: string,
) => ({
	source,
	sourceHandle,
	target,
	targetHandle,
});

describe("GraphManager zones", () => {
	it("creates a paired zone with a pass-through item", () => {
		const { graph, zoneId, outputId, item } = setup();
		expect(graph.activeZones.zones.get(zoneId)?.outputId).toBe(outputId);
		expect(graph.root.edges).toContainEqual(
			expect.objectContaining({ source: zoneId, target: outputId, targetHandle: item.id }),
		);
		expect(graph.resolveNodeOutputs(zoneId).map((o) => o.type)).toEqual(["i32", "f32"]);
	});

	it("rejects cycles through the zone and links leaving it", () => {
		const { graph, zoneId, outputId, item } = setup();
		expect(graph.isValidConnection(connection(outputId, item.id, zoneId, item.id))).toBe(false);
		expect(graph.isValidConnection(connection(zoneId, item.id, "out", "color"))).toBe(false);
		expect(graph.isValidConnection(connection(outputId, item.id, "out", "color"))).toBe(true);
		expect(graph.isValidConnection(connection("t", "time", zoneId, "iterations"))).toBe(true);
		// A vec2 can't feed the scalar iteration count.
		expect(graph.isValidConnection(connection("uv", "uv", zoneId, "iterations"))).toBe(false);
	});

	it("creates typed items from links dropped on the virtual handle", () => {
		const { graph, zoneId } = setup();
		expect(graph.isValidConnection(connection("uv", "uv", zoneId, NEW_ITEM_HANDLE))).toBe(true);
		graph.connectNewZoneItem(connection("uv", "uv", zoneId, NEW_ITEM_HANDLE));
		const items = graph.getZoneItems(zoneId);
		const created = items[items.length - 1];
		expect(created?.type).toBe("vec2f");
		expect(graph.root.edges).toContainEqual(
			expect.objectContaining({ source: "uv", target: zoneId, targetHandle: created?.id }),
		);
	});

	it("drops links that no longer fit when an item changes type or disappears", () => {
		const { graph, zoneId, outputId, item } = setup();
		graph.setZoneItemType(zoneId, item.id, "vec2f");
		graph.root.edges = [
			...graph.root.edges,
			{ id: "init", source: "uv", sourceHandle: "uv", target: zoneId, targetHandle: item.id },
		];
		graph.rebuildTypeCache();
		// A vec2f initial value can't feed an f32 item anymore.
		graph.setZoneItemType(zoneId, item.id, "f32");
		expect(graph.root.edges.some((e) => e.id === "init")).toBe(false);
		expect(graph.root.edges.some((e) => e.target === outputId)).toBe(true);
		graph.removeZoneItem(zoneId, item.id);
		expect(graph.root.edges.some((e) => e.source === zoneId || e.target === outputId)).toBe(
			false,
		);
	});

	it("deletes zone nodes in pairs", () => {
		const { graph, zoneId, outputId } = setup();
		const input = graph.root.nodesById.get(zoneId);
		if (!input) throw new Error("missing input");
		const expanded = graph.expandDeletion([input], []);
		expect(expanded.nodes.map((n) => n.id).toSorted()).toEqual([zoneId, outputId].toSorted());
		expect(expanded.edges.length).toBe(1);
	});

	it("groups whole zones and keeps them valid inside the group", () => {
		const { graph, zoneId, outputId, item } = setup();
		graph.root.edges = [
			...graph.root.edges,
			{
				id: "fin",
				source: outputId,
				sourceHandle: item.id,
				target: "out",
				targetHandle: "color",
			},
		];
		graph.rebuildTypeCache();
		graph.groupSelection(new Set([zoneId]));
		expect(graph.root.nodesById.has(zoneId)).toBe(false);
		expect(graph.root.nodesById.has(outputId)).toBe(false);
		const group = graph.root.nodes.find((n) => n.type === "node-group");
		expect(group).toBeDefined();
		const shader = generateShader(graph).shader;
		expect(shader).toContain("for (");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();

		// Ungrouping clones nodes with fresh ids: the pairing must follow.
		if (!group) return;
		graph.ungroupSelection(new Set([group.id]));
		const inputs = graph.root.nodes.filter((n) => n.type === "repeat-input");
		expect(inputs).toHaveLength(1);
		const clone = inputs[0];
		if (!clone) return;
		expect(graph.root.nodesById.get(pairedOutputId(clone) ?? "")?.type).toBe("repeat-output");
		expect(graph.activeZones.unpaired.size).toBe(0);
	});

	it("refuses groupings that would depend on themselves", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "cos" },
				{ id: "c", type: "tan" },
			],
			[
				["a", "result", "b", "e"],
				["b", "result", "c", "e"],
			],
		);
		graph.groupSelection(new Set(["a", "c"]));
		expect(graph.root.nodes.some((n) => n.type === "node-group")).toBe(false);
	});

	it("keeps item labels unique", () => {
		const { graph, zoneId, item } = setup();
		const second = graph.addZoneItem(zoneId, "i32");
		expect(second?.label).toBe("Value 2");
		expect(graph.renameZoneItem(zoneId, item.id, "Value 2")).toBe(false);
		expect(graph.renameZoneItem(zoneId, item.id, "Acc")).toBe(true);
		expect(graph.getZoneItems(zoneId).map((i) => i.label)).toEqual(["Acc", "Value 2"]);
	});
});
