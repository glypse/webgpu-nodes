import { describe, expect, it } from "bun:test";

import { GraphModel } from "../graph/model";
import { managerFor } from "../testing/graph";
import { type Asset, assetFile } from "./assets";
import { packBundle, unpackBundle } from "./bundle";

const image: Asset = {
	kind: "image",
	id: "a1",
	name: "Photo",
	file: assetFile("image", "a1", "Photo.JPG"),
	mime: "image/jpeg",
	bytes: 3,
	hash: "abc",
	width: 4,
	height: 2,
};

describe("assets", () => {
	it("files assets by kind and id, keeping the extension", () => {
		expect(image.file).toBe("assets/images/a1.jpg");
		expect(assetFile("video", "v", "clip")).toBe("assets/videos/v");
	});

	it("round-trips a project, its assets and their files through a bundle", async () => {
		const model = new GraphModel();
		model.addAsset(image);
		const bytes = packBundle({
			kind: "project",
			json: model.getProjectJson(),
			files: [[image.file, new Uint8Array([1, 2, 3])]],
		});

		const { json, files } = unpackBundle(bytes, "project");
		expect([...files.keys()]).toEqual([image.file]);
		expect([...(files.get(image.file) ?? [])]).toEqual([1, 2, 3]);
		const loaded = new GraphModel();
		expect((await loaded.loadFromString(json)).ok).toBe(true);
		expect(loaded.assets).toEqual([image]);
		expect(loaded.hasUnsavedChanges()).toBe(false);
	});

	it("rejects what isn't a bundle of the kind asked for", () => {
		const groups = packBundle({ kind: "groups", json: "{}", files: [] });
		expect(() => unpackBundle(groups, "project")).toThrow();
		expect(() => unpackBundle(new TextEncoder().encode("{}"), "project")).toThrow();
	});

	it("exports groups with the assets they read, and imports them", async () => {
		const source = managerFor(
			[
				{ id: "a", type: "sin", data: { asset: image.id } },
				{ id: "b", type: "sin" },
			],
			[["a", "result", "b", "e"]],
		);
		source.addAsset(image);
		source.addAsset({ ...image, id: "unused", hash: "other" });
		source.groupSelection(new Set(["a", "b"]));
		const ref = source.root.nodes.find((n) => n.type === "node-group")?.group?.definitionRef;
		if (!ref) throw new Error("not grouped");
		const { json, assets } = source.exportGroups(ref);
		expect(assets).toEqual([image]);

		// The target has the same file already, under another id.
		const target = new GraphModel();
		target.addAsset({ ...image, id: "mine" });
		const result = await target.importGroups([JSON.parse(json), { groups: "no" }]);
		expect(result).toMatchObject({ imported: 1, rejected: [1], added: [] });
		const node = target.project.definitions.get(ref)?.nodes.find((n) => n.data.asset);
		expect(node?.data.asset).toBe("mine");
		expect(target.assets.map((a) => a.id)).toEqual(["mine"]);

		const fresh = new GraphModel();
		expect((await fresh.importGroups([JSON.parse(json)])).added).toEqual([image]);
		expect(fresh.assets).toEqual([image]);
	});

	it("undoes adding, renaming and removing assets", () => {
		const model = new GraphModel();
		model.addAsset(image);
		model.recordHistory();
		model.renameAsset(image.id, "  Holiday ");
		model.recordHistory();
		expect(model.asset(image.id)?.name).toBe("Holiday");
		model.removeAsset(image.id);
		model.recordHistory();
		expect(model.assets).toEqual([]);

		model.undo();
		expect(model.asset(image.id)?.name).toBe("Holiday");
		model.undo();
		expect(model.asset(image.id)?.name).toBe("Photo");
		model.undo();
		expect(model.assets).toEqual([]);
		expect(model.hasUnsavedChanges()).toBe(false);
	});
});
