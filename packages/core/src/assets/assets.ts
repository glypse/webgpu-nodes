import * as v from "valibot";

export const ASSET_KINDS = ["image", "video"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Where a project bundle keeps each kind's files. */
export const ASSET_FOLDERS: Record<AssetKind, string> = {
	image: "assets/images",
	video: "assets/videos",
};

const AssetFields = {
	id: v.string(),
	/** Shown to the user; the file's name without its extension when imported. */
	name: v.string(),
	/** The file's path in the project bundle (see `assetFile`). */
	file: v.string(),
	mime: v.string(),
	bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
	/** SHA-256 of the file, hex: importing the same file twice reuses the asset. */
	hash: v.string(),
	width: v.pipe(v.number(), v.integer(), v.minValue(1)),
	height: v.pipe(v.number(), v.integer(), v.minValue(1)),
};

export const AssetSchema = v.variant("kind", [
	v.object({ kind: v.literal("image"), ...AssetFields }),
	v.object({
		kind: v.literal("video"),
		...AssetFields,
		/** Seconds. */
		duration: v.pipe(v.number(), v.minValue(0)),
	}),
]);

/** A file the project uses, e.g. an image. Its bytes live outside the model. */
export type Asset = v.InferOutput<typeof AssetSchema>;

/**
 * The bundle path of an asset's file: named by id, so names never collide
 * and renaming an asset never moves its file.
 */
export function assetFile(kind: AssetKind, id: string, filename: string): string {
	const dot = filename.lastIndexOf(".");
	const extension = dot > 0 ? filename.slice(dot).toLowerCase() : "";
	return `${ASSET_FOLDERS[kind]}/${id}${extension}`;
}

/** The kind of asset a file of `mime` type makes, if any. */
export function assetKindOf(mime: string): AssetKind | undefined {
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("video/")) return "video";
	return undefined;
}

/** A file's name without its extension. */
export function assetName(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot > 0 ? filename.slice(0, dot) : filename;
}
