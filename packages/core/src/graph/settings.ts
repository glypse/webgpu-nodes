import * as v from "valibot";

export const COLOR_SPACES = ["srgb", "display-p3"] as const;
export type ColorSpace = (typeof COLOR_SPACES)[number];

/** WebGPU's guaranteed largest texture side. */
export const MAX_CANVAS_SIZE = 8192;
export const MAX_FPS = 240;

const CanvasSizeSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1),
	v.maxValue(MAX_CANVAS_SIZE),
);

export const ProjectSettingsSchema = v.object({
	canvas: v.object({
		width: CanvasSizeSchema,
		height: CanvasSizeSchema,
		/** Render at the preview's size rather than `width` × `height` (which are kept for later). */
		followPreview: v.boolean(),
	}),
	timing: v.object({
		fps: v.pipe(v.number(), v.minValue(1), v.maxValue(MAX_FPS)),
		/** Draw on every display refresh, time following the wall clock, rather than at `fps`. */
		realtime: v.boolean(),
	}),
	/** The colour space frames are presented and exported in. */
	colorSpace: v.picklist(COLOR_SPACES),
});

/** How the project renders: saved with it and part of its undo history. */
export type ProjectSettings = v.InferOutput<typeof ProjectSettingsSchema>;

export function defaultSettings(): ProjectSettings {
	return {
		canvas: { width: 1920, height: 1080, followPreview: false },
		timing: { fps: 60, realtime: true },
		colorSpace: "srgb",
	};
}
