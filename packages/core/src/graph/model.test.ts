import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { libraryRef } from "../library";
import { libraryEntry, managerFor, rootProject, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import { NEW_ITEM_HANDLE, pairedOutputId } from "../zones";
import { type GraphProject, ROOT_ID } from "./document";
import { GraphModel } from "./model";

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

describe("GraphModel zones", () => {
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

describe("unsaved changes", () => {
	it("tracks edits since load and ignores the camera", () => {
		const graph = managerFor([{ id: "t", type: "time" }], []);
		expect(graph.hasUnsavedChanges()).toBe(false);
		graph.root.viewport = { x: 10, y: 20, zoom: 2 };
		expect(graph.hasUnsavedChanges()).toBe(false);
		graph.createRepeatZone({ x: 0, y: 0 });
		expect(graph.hasUnsavedChanges()).toBe(true);
		graph.markSaved();
		expect(graph.hasUnsavedChanges()).toBe(false);
	});
});

describe("undo / redo", () => {
	it("restores previous project content, including unrecorded edits", () => {
		const graph = managerFor([{ id: "t", type: "time" }], []);
		const zoneId = graph.createRepeatZone({ x: 0, y: 0 });
		if (!zoneId) throw new Error("zone not created");
		graph.recordHistory();
		graph.addZoneItem(zoneId, "vec3f"); // not recorded yet: undo must still catch it
		expect(graph.getZoneItems(zoneId)).toHaveLength(2);

		graph.undo();
		expect(graph.getZoneItems(zoneId)).toHaveLength(1);
		graph.undo();
		expect(graph.root.nodesById.has(zoneId)).toBe(false);
		graph.redo();
		graph.redo();
		expect(graph.getZoneItems(zoneId)).toHaveLength(2);
		expect(graph.history.canRedo).toBe(false);
	});

	it("keeps cameras and types after restoring", () => {
		const graph = managerFor([{ id: "u", type: "uv" }], []);
		graph.root.viewport = { x: 1, y: 2, zoom: 3 };
		graph.createRepeatZone({ x: 0, y: 0 });
		graph.undo();
		expect(graph.root.viewport).toEqual({ x: 1, y: 2, zoom: 3 });
		expect(graph.resolveOutputHandleType("u", "uv")).toBe("vec2f");
	});
});

describe("inferred types", () => {
	it("keeps the inferred type visible under a forced one", () => {
		const graph = managerFor(
			[
				{ id: "uv", type: "uv" },
				{ id: "s", type: "sin" },
			],
			[["uv", "uv", "s", "e"]],
		);
		graph.setNodeType("s", "vec4f");
		expect(graph.resolveInputType("s", "e")).toBe("vec4f");
		expect(graph.typeChoice("s")).toMatchObject({ forced: "vec4f", inferred: "vec2f" });
		graph.setNodeType("s", undefined);
		expect(graph.typeChoice("s")).toMatchObject({ forced: undefined, inferred: "vec2f" });
		expect(graph.root.nodesById.get("s")?.data.types).toBeUndefined();
	});
});

describe("group handle types", () => {
	it("retypes a handle and drops links that no longer fit, inside and outside", () => {
		const graph = managerFor([{ id: "uv", type: "uv" }], []);
		const groupId = graph.createGroup({ x: 0, y: 0 });
		const group = graph.root.nodesById.get(groupId ?? "");
		const ref = group?.group?.definitionRef ?? "";
		const inner = graph.project.definitions.get(ref);
		const input = inner?.nodes.find((n) => n.type === "group-input");
		const handle = (input?.data.handles as { id: string }[] | undefined)?.[0];
		if (!groupId || !input || !handle) throw new Error("group not created");

		graph.root.edges = [
			...graph.root.edges,
			{
				id: "feed",
				source: "uv",
				sourceHandle: "uv",
				target: groupId,
				targetHandle: handle.id,
			},
		];
		graph.setHandleType(ref, input.id, handle.id, "vec2f");
		expect(graph.root.edges.some((e) => e.id === "feed")).toBe(true);
		// The inner pass-through goes to an f32 output: a vec2f no longer fits it.
		expect(inner?.edges.some((e) => e.source === input.id)).toBe(false);

		graph.setHandleType(ref, input.id, handle.id, "f32");
		expect(graph.root.edges.some((e) => e.id === "feed")).toBe(false);
		expect(graph.resolveNodeOutputs(input.id)[0]?.type).toBe("f32");
	});
});

describe("reroute", () => {
	it("forwards the type of whatever feeds it", () => {
		const graph = managerFor(
			[
				{ id: "uv", type: "uv" },
				{ id: "r1", type: "reroute" },
				{ id: "r2", type: "reroute" },
			],
			[
				["uv", "uv", "r1", "in"],
				["r1", "out", "r2", "in"],
			],
		);
		expect(graph.resolveOutputHandleType("r2", "out")).toBe("vec2f");
		expect(
			graph.isValidConnection({
				source: "r2",
				sourceHandle: "out",
				target: "out",
				targetHandle: "color",
			}),
		).toBe(true);
	});
});

describe("node data edits", () => {
	it("replaces the node instead of mutating it", () => {
		const graph = managerFor([{ id: "s", type: "sin" }], []);
		const before = graph.root.nodesById.get("s");
		graph.setInputValue("s", "e", 2);
		const after = graph.root.nodesById.get("s");
		expect(after).not.toBe(before);
		expect(after?.data.values?.e).toBe(2);
		graph.setInputValue("s", "e", undefined);
		expect(graph.root.nodesById.get("s")?.data.values).toBeUndefined();
		graph.setSetting("s", "op", "x");
		expect(graph.root.nodesById.get("s")?.data.settings).toEqual({ op: "x" });
	});

	it("adds handles to group boundary nodes only", () => {
		const graph = managerFor([{ id: "s", type: "sin" }], []);
		expect(graph.addHandle("s", "f32")).toBeUndefined();
		const groupId = graph.createGroup({ x: 0, y: 0 });
		graph.enterGroup(groupId ?? "");
		const input = graph.activeDocument.nodes.find((n) => n.type === "group-input");
		const handle = graph.addHandle(input?.id ?? "", "vec3f");
		expect(handle?.label).toBe("Input 2");
		expect(graph.resolveNodeOutputs(input?.id ?? "").map((o) => o.type)).toEqual([
			"f32",
			"vec3f",
		]);
	});
});

describe("standard-library versions", () => {
	const aspectUv = libraryEntry("std-aspect-uv");
	const oldRef = libraryRef(aspectUv.id, "0000000000old");
	const instance = (ref: string): TestNode => ({
		id: "a",
		type: "node-group",
		group: { definitionRef: ref, locked: true },
	});

	it("saves the version a node uses, not the library itself", async () => {
		const graph = managerFor([instance(aspectUv.ref)], [["a", "uv", "out", "color"]]);
		const saved = JSON.parse(graph.getProjectJson()) as GraphProject;
		expect(Object.keys(saved.definitions)).toEqual([ROOT_ID]);

		const loaded = managerFor([], []);
		expect(await loaded.loadProject(saved)).toBe(true);
		expect(loaded.resolveNodeOutputs("a").map((o) => o.id)).toEqual(["uv"]);
		expect(loaded.outdatedLibraryVersion("a")).toBeUndefined();
	});

	it("stands the latest version in for an older one while archives are off", () => {
		const graph = managerFor([instance(oldRef)], [["a", "uv", "out", "color"]]);
		expect(graph.resolveNodeOutputs("a").map((o) => o.id)).toEqual(["uv"]);
		expect(graph.outdatedLibraryVersion("a")).toEqual({
			label: aspectUv.label,
			archived: false,
		});
	});

	it("fetches the archived versions a project uses, only when loading it", async () => {
		const requested: string[] = [];
		class ArchivingModel extends GraphModel {
			protected override archivedVersionsEnabled = true;
			protected override loadArchivedVersion = (ref: string) => {
				requested.push(ref);
				const definition = structuredClone(aspectUv.definition);
				const output = definition.nodes.find((n) => n.type === "group-output");
				output?.data.handles?.push({ id: "extra", label: "Extra", type: "f32" });
				return Promise.resolve({ ...aspectUv, ref, version: "0000000000old", definition });
			};
		}
		const graph = new ArchivingModel();
		expect(requested).toEqual([]);

		const project = rootProject([instance(oldRef), { ...instance(aspectUv.ref), id: "b" }], []);
		expect(await graph.loadProject(project)).toBe(true);
		expect(requested).toEqual([oldRef]);
		expect(graph.resolveNodeOutputs("a").map((o) => o.id)).toEqual(["uv", "extra"]);
		expect(graph.resolveNodeOutputs("b").map((o) => o.id)).toEqual(["uv"]);
		expect(graph.outdatedLibraryVersion("a")).toEqual({
			label: aspectUv.label,
			archived: true,
		});
	});
});
