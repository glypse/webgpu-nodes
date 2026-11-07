import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { standardLibrary } from "../library";
import { rootProject } from "../testing/graph";
import { type GraphDocumentNode, ROOT_ID } from "./document";
import { MAX_DEFINITIONS } from "./limits";
import { GraphModel } from "./model";
import type { GroupsFile } from "./schema";

type Definition = GroupsFile["groups"][number]["definition"];

const at = { x: 0, y: 0 };

function sinDocument(id: string): Definition {
	return { nodes: [{ id, type: "sin", data: {}, position: at }], edges: [] };
}

function nesting(id: string, definitionRef: string): Definition {
	const node: GraphDocumentNode = {
		id,
		type: "node-group",
		data: {},
		position: at,
		group: { definitionRef, locked: false },
	};
	return { nodes: [node], edges: [] };
}

function entry(id: string, definition: Definition, dependencies: string[] = []) {
	return { id, label: id, category: "group", dependencies, definition };
}

function fileOf(...groups: GroupsFile["groups"]): GroupsFile {
	return { groups, assets: [] };
}

function mine(): GraphModel {
	const project = rootProject([{ id: "mine", type: "sin" }], []);
	project.definitions.user = sinDocument("user-node");
	return new GraphModel(project);
}

const asset: Asset = {
	kind: "image",
	id: "a1",
	name: "Photo",
	file: "assets/images/a1.png",
	mime: "image/png",
	bytes: 3,
	hash: "a".repeat(64),
	width: 1,
	height: 1,
};

describe("importing groups", () => {
	it("can't replace the root", async () => {
		const model = mine();
		const before = model.getProjectJson();
		const result = await model.importGroups([fileOf(entry(ROOT_ID, sinDocument("evil")))]);
		expect(result.ok).toBe(false);
		expect(model.getProjectJson()).toBe(before);
		expect(model.root.locked).toBe(false);
	});

	it("can't replace the standard library", async () => {
		const [library] = standardLibrary;
		if (!library) throw new Error("no library");
		const model = mine();
		const before = model.project.definitions.get(library.ref);
		const result = await model.importGroups([fileOf(entry(library.ref, sinDocument("evil")))]);
		expect(result).toMatchObject({ ok: true, value: { imported: 0 } });
		expect(model.project.definitions.get(library.ref)).toBe(before);
		expect(model.project.definitions.get(library.ref)?.nodesById.has("evil")).toBe(false);
	});

	it("brings a group differing from the project's in as a copy", async () => {
		const model = mine();
		const before = model.project.definitions.get("user");
		const file = fileOf(
			entry("user", sinDocument("evil")),
			entry("outer", nesting("n", "user"), ["user"]),
		);
		const result = await model.importGroups([file]);
		expect(result).toMatchObject({ ok: true, value: { imported: 2, missing: [] } });
		expect(model.project.definitions.get("user")).toBe(before);

		const outer = model.project.definitions.get("outer");
		const copy = outer?.nodes[0]?.group?.definitionRef;
		expect(copy).toBeDefined();
		expect(copy).not.toBe("user");
		expect(model.project.definitions.get(copy ?? "")?.nodesById.has("evil")).toBe(true);
	});

	it("copies a group the project has too, when what it nests had to be copied", async () => {
		const model = mine();
		const shared = nesting("n", "user");
		await model.importGroups([fileOf(entry("outer", shared))]);
		const before = model.project.definitions.get("outer");

		const file = fileOf(entry("user", sinDocument("evil")), entry("outer", shared, ["user"]));
		expect((await model.importGroups([file])).ok).toBe(true);
		expect(model.project.definitions.get("outer")).toBe(before);
		expect(before?.nodes[0]?.group?.definitionRef).toBe("user");
	});

	it("adds nothing for groups the project has already", async () => {
		const model = mine();
		const ref = (() => {
			model.groupSelection(new Set(["mine"]));
			const group = model.root.nodes.find((n) => n.type === "node-group")?.group;
			if (!group) throw new Error("not grouped");
			return group.definitionRef;
		})();
		const file = JSON.parse(model.exportGroups(ref).json) as GroupsFile;
		const count = model.project.definitions.size;
		expect((await model.importGroups([file])).ok).toBe(true);
		expect(model.project.definitions.size).toBe(count);
	});

	it("keeps a group's interface through export and import", async () => {
		const project = rootProject([], []);
		project.definitions.g = {
			...sinDocument("s"),
			inputs: [{ id: "a", label: "A", type: "f32" }],
			outputs: [{ id: "b", label: "B", type: "f32" }],
			defaults: { a: 2 },
		};
		const file = JSON.parse(new GraphModel(project).exportGroups("g").json) as GroupsFile;
		const target = new GraphModel();
		expect((await target.importGroups([file])).ok).toBe(true);
		const imported = target.project.definitions.get("g");
		expect(imported?.inputs.map((h) => h.id)).toEqual(["a"]);
		expect(imported?.outputs.map((h) => h.id)).toEqual(["b"]);
		expect(imported?.defaults).toEqual({ a: 2 });
	});

	it("rejects cycles, within the file or through the project's groups", async () => {
		const model = mine();
		const before = model.getProjectJson();
		const cycle = fileOf(entry("a", nesting("x", "b")), entry("b", nesting("y", "a")));
		expect(await model.importGroups([cycle])).toMatchObject({
			ok: false,
			error: { kind: "invalid-graph", issues: [{ kind: "group-cycle" }] },
		});

		const self = fileOf(entry("c", nesting("z", "c")));
		expect((await model.importGroups([self])).ok).toBe(false);
		expect(model.getProjectJson()).toBe(before);
	});

	it("rejects a broken definition without importing anything", async () => {
		const model = mine();
		const before = model.getProjectJson();
		const broken: Definition = {
			nodes: sinDocument("a").nodes,
			edges: [
				{ id: "e", source: "a", target: "a", sourceHandle: "result", targetHandle: "e" },
			],
		};
		const assets = [asset];
		const result = await model.importGroups([
			{ groups: [entry("good", sinDocument("g")), entry("bad", broken)], assets },
		]);
		expect(result.ok).toBe(false);
		expect(model.getProjectJson()).toBe(before);
		expect(model.assets).toEqual([]);
	});

	it("rejects more definitions than a project can hold", async () => {
		const groups = Array.from({ length: MAX_DEFINITIONS + 1 }, (_, i) =>
			entry(String(i), sinDocument(String(i))),
		);
		expect((await mine().importGroups([{ groups, assets: [] }])).ok).toBe(false);
	});

	it("gives an asset whose id names another file an id of its own", async () => {
		const model = mine();
		model.addAsset(asset);
		const other: Asset = { ...asset, hash: "b".repeat(64) };
		const document: Definition = {
			nodes: [{ id: "i", type: "sin", data: { asset: other.id }, position: at }],
			edges: [],
		};
		const result = await model.importGroups([
			{ groups: [entry("g", document)], assets: [other] },
		]);
		if (!result.ok) throw new Error(result.error.kind);
		const [added] = result.value.added;
		expect(added?.source).toEqual({ bundle: 0, path: other.file });
		expect(added?.asset.id).not.toBe(asset.id);
		expect(added?.asset.file).toBe(`assets/images/${added?.asset.id ?? ""}.png`);
		expect(model.asset(asset.id)?.hash).toBe(asset.hash);
		const node = model.project.definitions.get("g")?.nodes[0];
		expect(node?.data.asset).toBe(added?.asset.id);
	});

	it("reports what it can't find", async () => {
		const result = await mine().importGroups([fileOf(entry("a", sinDocument("x"), ["gone"]))]);
		expect(result).toMatchObject({ ok: true, value: { missing: ["a depends on gone"] } });
	});
});
