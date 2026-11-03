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

export const VIDEO_ENDS = ["loop", "hold", "transparent"] as const;
/** What a video shows past its end: its start again, its last frame, or nothing. */
export type VideoEnd = (typeof VIDEO_ENDS)[number];

export const VideoPlaybackSchema = v.object({
	/** Project seconds at which the video's first frame shows. */
	start: v.number(),
	/** Video seconds per project second. */
	speed: v.number(),
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
