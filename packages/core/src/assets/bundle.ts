import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from "fflate";

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
	for (const [path, data] of files) entries[path] = [data, { level: 0 }];
	return zipSync(entries);
}

/** Read a bundle of `kind`; throws when it isn't a zip or holds another kind. */
export function unpackBundle(bytes: Uint8Array, kind: BundleKind): Bundle {
	// fflate allocates plain (never shared) buffers.
	const entries = unzipSync(bytes) as Record<string, Uint8Array<ArrayBuffer>>;
	const name = BUNDLE_JSON[kind];
	const json = entries[name];
	if (!json) throw new Error(`The bundle has no ${name}.`);
	const files = new Map(
		Object.entries(entries).filter(([path]) => path !== name && !path.endsWith("/")),
	);
	return { kind, json: strFromU8(json), files };
}
