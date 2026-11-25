import { describe, expect, it } from "bun:test";

import { GraphModel } from "../graph/model";
import type { GroupsFile } from "../graph/schema";
import { parseGroups } from "../graph/validate";
import { managerFor } from "../testing/graph";
import { type Asset, assetFile, DEFAULT_PLAYBACK, VIDEO_TIME_TOLERANCE, videoTime } from "./assets";
import { packBundle, unpackBundle } from "./bundle";

const image: Asset = {
	kind: "image",
	id: "a1",
	name: "Photo",
	file: assetFile("image", "a1", "Photo.JPG"),
	mime: "image/jpeg",
	bytes: 3,
	hash: "a".repeat(64),
	width: 4,
	height: 2,
};

function groupsOf(json: string): GroupsFile {
	const parsed = parseGroups(json);
	if (!parsed.ok) throw new Error(parsed.error.kind);
	return parsed.value;
}

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

		const bundle = unpackBundle(bytes, "project");
		if (!bundle.ok) throw new Error(bundle.error.kind);
		const { json, files } = bundle.value;
		expect([...files.keys()]).toEqual([image.file]);
		expect([...(files.get(image.file) ?? [])]).toEqual([1, 2, 3]);
		const loaded = new GraphModel();
		expect((await loaded.loadFromString(json)).ok).toBe(true);
		expect(loaded.assets).toEqual([image]);
		expect(loaded.hasUnsavedChanges()).toBe(false);
	});

	it("rejects what isn't a bundle of the kind asked for", () => {
		const groups = packBundle({ kind: "groups", json: "{}", files: [] });
		expect(unpackBundle(groups, "project")).toEqual({
			ok: false,
			error: { kind: "missing-json", name: "project.json" },
		});
		expect(unpackBundle(new TextEncoder().encode("{}"), "project")).toEqual({
			ok: false,
			error: { kind: "not-a-bundle" },
		});
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
		source.addAsset({ ...image, id: "unused", hash: "b".repeat(64) });
		source.groupSelection(new Set(["a", "b"]));
		const ref = source.root.nodes.find((n) => n.type === "node-group")?.group?.definitionRef;
		if (!ref) throw new Error("not grouped");
		const { json, assets } = source.exportGroups(ref);
		expect(assets).toEqual([image]);

		// The target has the same file already, under another id.
		const target = new GraphModel();
		target.addAsset({ ...image, id: "mine" });
		const result = await target.importGroups([groupsOf(json)]);
		expect(result).toMatchObject({ ok: true, value: { imported: 1, added: [] } });
		const node = target.project.definitions.get(ref)?.nodes.find((n) => n.data.asset);
		expect(node?.data.asset).toBe("mine");
		expect(target.assets.map((a) => a.id)).toEqual(["mine"]);

		const fresh = new GraphModel();
		const imported = await fresh.importGroups([groupsOf(json)]);
		expect(imported.ok && imported.value.added.map((a) => a.asset)).toEqual([image]);
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

describe("videoTime", () => {
	const frameShown = (fps: number, t: number | undefined) =>
		t === undefined ? undefined : Math.floor(t * fps);
	const duration = 1000;

	it("shows frame k at the rounded time of its start, and the one before at a frame earlier", () => {
		for (const fps of [24, 25, 30, 29.97, 60]) {
			for (let k = 1; k <= 3000; k++) {
				const time = Math.fround(k / fps);
				expect(frameShown(fps, videoTime(DEFAULT_PLAYBACK, time, duration))).toBe(k);
				const before = Math.fround(time - Math.fround(1 / fps));
				expect(frameShown(fps, videoTime(DEFAULT_PLAYBACK, before, duration))).toBe(k - 1);
			}
		}
	});

	it("shows frame k at exactly k / fps, for exports and unlinked times", () => {
		for (const fps of [24, 30, 29.97, 60]) {
			for (let k = 0; k <= 3000; k++) {
				const t = videoTime(DEFAULT_PLAYBACK, k / fps, duration);
				expect(frameShown(fps, t)).toBe(k);
			}
		}
	});

	it("isn't before the start for a time a hair under it, and is for one beyond the tolerance", () => {
		const playback = { ...DEFAULT_PLAYBACK, start: 2.1 };
		expect(frameShown(30, videoTime(playback, 2.0999999, duration))).toBe(0);
		expect(videoTime(playback, 2.1 - 2 * VIDEO_TIME_TOLERANCE, duration)).toBeUndefined();
	});

	it("wraps to the start when a loop's end is a hair away, and not for the frame before it", () => {
		const playback = { ...DEFAULT_PLAYBACK, end: "loop" } as const;
		expect(videoTime(playback, 10 - 1e-6, 10)).toBeLessThan(0.01);
		expect(videoTime(playback, 10 - 1 / 30, 10)).toBeGreaterThan(9.9);
	});

	it("moves forward by the tolerance whatever the speed", () => {
		const backwards = { ...DEFAULT_PLAYBACK, start: 0, speed: -1, end: "loop" } as const;
		const t = videoTime(backwards, 1, 10) ?? NaN;
		// Video time -1, which is 9 into the loop; a hair later, not earlier.
		expect(t).toBeCloseTo(9 + VIDEO_TIME_TOLERANCE, 9);
		const fast = { ...DEFAULT_PLAYBACK, speed: 2 };
		expect(videoTime(fast, 1, 10)).toBeCloseTo(2 + VIDEO_TIME_TOLERANCE, 9);
	});

	it("holds and hides past the end", () => {
		expect(videoTime({ ...DEFAULT_PLAYBACK, end: "hold" }, 50, 10)).toBe(10);
		expect(videoTime({ ...DEFAULT_PLAYBACK, end: "transparent" }, 50, 10)).toBeUndefined();
	});
});
