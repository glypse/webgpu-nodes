import * as v from "valibot";

import { FiniteSchema, LabelSchema, MAX_ASSET_SIDE, MAX_ID_LENGTH } from "../graph/limits";

export const ASSET_KINDS = ["image", "video"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Where a project bundle keeps each kind's files. */
export const ASSET_FOLDERS: Record<AssetKind, string> = {
	image: "assets/images",
	video: "assets/videos",
};

/** A file's name in its folder: its asset's id, then the extension `assetFile` kept, if any. */
const FILE_NAME = /^[A-Za-z0-9_-]+(\.[a-z0-9]{1,8})?$/;
const EXTENSION = /^\.[a-z0-9]{1,8}$/;
const MIME = /^(image|video)\/[a-z0-9][a-z0-9.+-]*$/;
/** Images that are documents: opened as one, an SVG runs its scripts. */
const DOCUMENT_MIMES = new Set(["image/svg+xml"]);

const AssetSideSchema = v.pipe(
	FiniteSchema,
	v.integer(),
	v.minValue(1),
	v.maxValue(MAX_ASSET_SIDE),
);

const AssetFields = {
	id: v.pipe(v.string(), v.maxLength(MAX_ID_LENGTH), v.regex(/^[A-Za-z0-9_-]+$/)),
	/** Shown to the user; the file's name without its extension when imported. */
	name: LabelSchema,
	/** The file's path in the project bundle (see `assetFile`). */
	file: v.pipe(v.string(), v.check(isAssetPath)),
	mime: v.string(),
	bytes: v.pipe(FiniteSchema, v.integer(), v.minValue(0)),
	/** SHA-256 of the file, hex: importing the same file twice reuses the asset. */
	hash: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
	width: AssetSideSchema,
	height: AssetSideSchema,
};

export const AssetSchema = v.pipe(
	v.variant("kind", [
		v.object({ kind: v.literal("image"), ...AssetFields }),
		v.object({
			kind: v.literal("video"),
			...AssetFields,
			/** Seconds. */
			duration: v.pipe(FiniteSchema, v.minValue(0)),
		}),
	]),
	v.check(
		({ kind, id, file }) => assetFile(kind, id, file) === file,
		"An asset's file is named after it.",
	),
	v.check(({ kind, mime }) => assetKindOf(mime) === kind, "An asset's file is of its kind."),
);

/** A file the project uses, e.g. an image. Its bytes live outside the model. */
export type Asset = v.InferOutput<typeof AssetSchema>;

/**
 * The bundle path of an asset's file: named by id, so names never collide
 * and renaming an asset never moves its file.
 */
export function assetFile(kind: AssetKind, id: string, filename: string): string {
	const dot = filename.lastIndexOf(".");
	const extension = dot > 0 ? filename.slice(dot).toLowerCase() : "";
	return `${ASSET_FOLDERS[kind]}/${id}${EXTENSION.test(extension) ? extension : ""}`;
}

/**
 * Whether `path` is one `assetFile` gives. Bundle paths come from files, and
 * end up as zip entries: anything else could stand for the bundle's JSON, or
 * lead out of the folder it's extracted to.
 */
export function isAssetPath(path: string): boolean {
	return Object.values(ASSET_FOLDERS).some(
		(folder) => path.startsWith(`${folder}/`) && FILE_NAME.test(path.slice(folder.length + 1)),
	);
}

/** The kind of asset a file of `mime` type makes, if any. */
export function assetKindOf(mime: string): AssetKind | undefined {
	if (!MIME.test(mime) || DOCUMENT_MIMES.has(mime)) return undefined;
	return mime.startsWith("image/") ? "image" : "video";
}

/** SHA-256 of a file's bytes, hex. */
export async function assetHash(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A file's name without its extension. */
export function assetName(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot > 0 ? filename.slice(0, dot) : filename;
}

export const VIDEO_ENDS = ["loop", "hold", "transparent"] as const;
/** What a video shows past its end: its start again, its last frame, or nothing. */
export type VideoEnd = (typeof VIDEO_ENDS)[number];

export const VideoPlaybackSchema = v.object({
	/** Project seconds at which the video's first frame shows. */
	start: FiniteSchema,
	/** Video seconds per project second. */
	speed: FiniteSchema,
	end: v.picklist(VIDEO_ENDS),
});

/** How a Video node plays its file along the project's time. */
export type VideoPlayback = v.InferOutput<typeof VideoPlaybackSchema>;

export const DEFAULT_PLAYBACK: VideoPlayback = { start: 0, speed: 1, end: "loop" };

/**
 * The time in a video of `duration` seconds shown at project time `time`,
 * or undefined when nothing shows (before its start, or past its end when
 * `end` is "transparent").
 */
export function videoTime(
	playback: VideoPlayback,
	time: number,
	duration: number,
): number | undefined {
	if (time < playback.start) return undefined;
	const t = (time - playback.start) * playback.speed;
	if (duration <= 0) return 0;
	if (t >= 0 && t < duration) return t;
	switch (playback.end) {
		case "loop":
			return ((t % duration) + duration) % duration;
		case "hold":
			return Math.min(Math.max(t, 0), duration);
		case "transparent":
			return undefined;
	}
}
