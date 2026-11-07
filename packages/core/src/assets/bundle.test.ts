import { describe, expect, it } from "bun:test";

import { strToU8, zipSync } from "fflate";
import * as v from "valibot";

import { MAX_ASSETS, MAX_JSON_BYTES } from "../graph/limits";
import { GraphModel } from "../graph/model";
import { type Asset, assetFile, assetHash, assetKindOf, AssetSchema, isAssetPath } from "./assets";
import { packBundle, unpackBundle, verifiedFiles } from "./bundle";

const JSON_ENTRY = strToU8("{}");

async function imageOf(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<Asset> {
	return {
		kind: "image",
		id,
		name: id,
		file: assetFile("image", id, `${id}.png`),
		mime: "image/png",
		bytes: bytes.length,
		hash: await assetHash(bytes),
		width: 1,
		height: 1,
	};
}

const valid: Asset = {
	kind: "image",
	id: "a1",
	name: "Photo",
	file: "assets/images/a1.png",
	mime: "image/png",
	bytes: 3,
	hash: "a".repeat(64),
	width: 4,
	height: 2,
};

const accepts = (asset: unknown) => v.safeParse(AssetSchema, asset).success;

describe("asset metadata", () => {
	it("accepts what importing a file gives", () => {
		expect(accepts(valid)).toBe(true);
	});

	it("only takes paths of the asset's own folder and name", () => {
		for (const file of [
			"project.json",
			"groups.json",
			"../../evil",
			"assets/images/../../project.json",
			"assets/images/a1/../../../evil.png",
			"assets/videos/a1.png",
			"assets/images/other.png",
			"assets/images/a1.png/x",
			"__proto__",
		]) {
			expect(accepts({ ...valid, file })).toBe(false);
		}
		expect(accepts({ ...valid, id: "../a1" })).toBe(false);
	});

	it("only takes hashes and media types that can be real", () => {
		expect(accepts({ ...valid, hash: "abc" })).toBe(false);
		expect(accepts({ ...valid, mime: "text/html" })).toBe(false);
		expect(accepts({ ...valid, mime: "image/svg+xml" })).toBe(false);
		expect(accepts({ ...valid, mime: "video/mp4" })).toBe(false);
		expect(assetKindOf("image/svg+xml")).toBeUndefined();
		expect(assetKindOf("image/png; charset=x")).toBeUndefined();
	});

	it("keeps only tame extensions in bundle paths", () => {
		expect(assetFile("image", "a", "x/../../evil")).toBe("assets/images/a");
		expect(assetFile("image", "a", "photo.JPG")).toBe("assets/images/a.jpg");
		expect(isAssetPath(assetFile("image", "a", "b.tar/../../etc"))).toBe(true);
		expect(assetFile("image", "a", "b.tar/../../etc")).toBe("assets/images/a");
	});
});

describe("bundles", () => {
	it("refuses to pack a path that isn't an asset's", () => {
		for (const path of ["project.json", "../evil", "__proto__"]) {
			expect(() =>
				packBundle({ kind: "project", json: "{}", files: [[path, new Uint8Array(1)]] }),
			).toThrow();
		}
	});

	it("leaves out entries that can't be assets' files", () => {
		const bytes = zipSync({
			"project.json": JSON_ENTRY,
			"../evil": new Uint8Array(1),
			"assets/images/": new Uint8Array(0),
			"assets/images/a.png": new Uint8Array(1),
		});
		const bundle = unpackBundle(bytes, "project");
		expect(bundle.ok && [...bundle.value.files.keys()]).toEqual(["assets/images/a.png"]);
	});

	it("rejects assets inflating far beyond the bundle, before inflating them", () => {
		const bomb = zipSync({
			"project.json": JSON_ENTRY,
			"assets/images/a.png": [new Uint8Array(64 * 1024 * 1024), { level: 9 }],
		});
		expect(unpackBundle(bomb, "project")).toEqual({
			ok: false,
			error: { kind: "too-large", what: "its files" },
		});
	});

	it("rejects JSON inflating past the limit", () => {
		const bomb = zipSync({
			"project.json": [new Uint8Array(MAX_JSON_BYTES + 1), { level: 9 }],
		});
		expect(unpackBundle(bomb, "project")).toEqual({
			ok: false,
			error: { kind: "too-large", what: "its JSON" },
		});
	});

	it("rejects more entries than a project has assets", () => {
		const entries: Record<string, Uint8Array> = { "project.json": JSON_ENTRY };
		for (let i = 0; i <= MAX_ASSETS + 1; i++) entries[`x${String(i)}`] = new Uint8Array(0);
		expect(unpackBundle(zipSync(entries), "project")).toEqual({
			ok: false,
			error: { kind: "too-large", what: "too many files" },
		});
	});

	it("rejects a name given twice, which would inflate twice", () => {
		const bytes = zipSync({ "project.json": JSON_ENTRY, "project.jsoN": JSON_ENTRY });
		const text = new TextDecoder("latin1").decode(bytes);
		for (
			let at = text.indexOf("project.jsoN");
			at >= 0;
			at = text.indexOf("project.jsoN", at + 1)
		) {
			bytes.set(strToU8("project.json"), at);
		}
		expect(unpackBundle(bytes, "project")).toEqual({
			ok: false,
			error: { kind: "not-a-bundle" },
		});
	});

	it("keeps files that are what their asset says, and no others", async () => {
		const honest = new Uint8Array([1, 2, 3]);
		const forged = new Uint8Array([4, 5, 6]);
		const a = await imageOf("a", honest);
		const b = await imageOf("b", honest);
		const short = await imageOf("c", honest);
		const bytes = packBundle({
			kind: "project",
			json: "{}",
			files: [
				[a.file, honest],
				[b.file, forged],
				[short.file, honest.subarray(1)],
			],
		});
		const bundle = unpackBundle(bytes, "project");
		if (!bundle.ok) throw new Error(bundle.error.kind);
		const missing = { ...a, id: "d", file: "assets/images/d.png" };
		const { files, altered } = await verifiedFiles(bundle.value, [a, b, short, missing]);
		expect([...files.keys()]).toEqual(["a"]);
		expect(altered).toEqual([b, short]);
	});

	it("keeps a save with assets loadable", async () => {
		const data = new Uint8Array([1, 2, 3]);
		const asset = await imageOf("a", data);
		const model = new GraphModel();
		model.addAsset(asset);
		const bundle = unpackBundle(
			packBundle({
				kind: "project",
				json: model.getProjectJson(),
				files: [[asset.file, data]],
			}),
			"project",
		);
		if (!bundle.ok) throw new Error(bundle.error.kind);
		expect((await new GraphModel().loadFromString(bundle.value.json)).ok).toBe(true);
	});
});
