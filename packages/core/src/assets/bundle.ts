import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from "fflate";

import { MAX_ASSETS, MAX_BUNDLE_BYTES, MAX_JSON_BYTES } from "../graph/limits";
import type { LoadResult } from "../graph/validate";
import { err, ok } from "../result";
import { type Asset, assetHash, isAssetPath } from "./assets";

/**
 * What a bundle holds: a whole project, or groups exported to be imported
 * into others. Either way, its JSON sits beside the files of the assets it uses.
 */
export const BUNDLE_KINDS = ["project", "groups"] as const;
export type BundleKind = (typeof BUNDLE_KINDS)[number];

/** Each kind's JSON inside a bundle; every other file is an asset's. */
export const BUNDLE_JSON: Record<BundleKind, string> = {
	project: "project.json",
	groups: "groups.json",
};

export const BUNDLE_EXTENSIONS: Record<BundleKind, string> = {
	project: ".wgnodes",
	groups: ".wggroups",
};

/**
 * How much more a bundle's assets can weigh than the bundle. We store media
 * as it is, so anything near this was made to inflate; some room is left for
 * bundles zipped again by other tools.
 */
const MAX_ASSET_EXPANSION = 4;

/** A bundle's contents: its JSON, and its assets' files by bundle path. */
export type Bundle = {
	kind: BundleKind;
	json: string;
	files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
};

export function packBundle({
	kind,
	json,
	files,
}: {
	kind: BundleKind;
	json: string;
	files: Iterable<readonly [string, Uint8Array]>;
}): Uint8Array<ArrayBuffer> {
	// Media is compressed already: storing it saves time for nothing lost.
	const entries: Zippable = { [BUNDLE_JSON[kind]]: [strToU8(json), { level: 6 }] };
	for (const [path, data] of files) {
		if (!isAssetPath(path)) throw new Error(`"${path}" isn't an asset's path.`);
		entries[path] = [data, { level: 0 }];
	}
	return zipSync(entries);
}

class BundleTooLarge extends Error {}

/**
 * Read a bundle of `kind`, keeping only its JSON and what can be assets'
 * files. Nothing is inflated past the sizes checked here: fflate allocates
 * what an entry declares and stops there, whatever its data would give.
 */
export function unpackBundle(bytes: Uint8Array, kind: BundleKind): LoadResult<Bundle> {
	if (bytes.length > MAX_BUNDLE_BYTES) return err({ kind: "too-large", what: "the bundle" });
	const name = BUNDLE_JSON[kind];
	const names = new Set<string>();
	let assetBytes = 0;
	let unzipped: Record<string, Uint8Array<ArrayBuffer>>;
	try {
		unzipped = unzipSync(bytes, {
			filter: ({ name: entry, size, originalSize }) => {
				// A name given twice would inflate twice, for only one result.
				if (names.has(entry)) throw new Error("A bundle's files have names of their own.");
				names.add(entry);
				if (names.size > MAX_ASSETS + 1) throw new BundleTooLarge("too many files");
				if (entry === name) {
					if (originalSize > MAX_JSON_BYTES) throw new BundleTooLarge("its JSON");
					return true;
				}
				if (!isAssetPath(entry)) return false;
				// Stored entries are read by `size`, deflated ones by `originalSize`.
				assetBytes += Math.max(size, originalSize);
				if (assetBytes > bytes.length * MAX_ASSET_EXPANSION) {
					throw new BundleTooLarge("its files");
				}
				return true;
			},
		});
	} catch (error) {
		return err(
			error instanceof BundleTooLarge
				? { kind: "too-large", what: error.message }
				: { kind: "not-a-bundle" },
		);
	}
	const json = unzipped[name];
	if (!json) return err({ kind: "missing-json", name });
	const files = new Map(Object.entries(unzipped).filter(([path]) => path !== name));
	return ok({ kind, json: strFromU8(json), files });
}

/**
 * The files of `assets` in a bundle by asset id, as long as they're what
 * their asset says. Those that aren't are `altered`: a file's hash decides
 * which asset stands for it, so it can't be taken at the bundle's word.
 */
export async function verifiedFiles(
	bundle: Bundle,
	assets: readonly Asset[],
): Promise<{ files: Map<string, Uint8Array<ArrayBuffer>>; altered: Asset[] }> {
	const files = new Map<string, Uint8Array<ArrayBuffer>>();
	const altered: Asset[] = [];
	for (const asset of assets) {
		const data = bundle.files.get(asset.file);
		if (!data) continue;
		if (data.length === asset.bytes && (await assetHash(data)) === asset.hash) {
			files.set(asset.id, data);
		} else {
			altered.push(asset);
		}
	}
	return { files, altered };
}
