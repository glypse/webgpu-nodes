import type { Size } from "$runtime";
import {
	BufferTarget,
	type MkvOutputFormat,
	Mp4OutputFormat,
	Output,
	Quality,
	type VideoCodec,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat,
	getFirstEncodableVideoCodec,
} from "mediabunny";

import type { Preview } from "./preview.svelte";
import { downloadFile } from "./utils";

export const VIDEO_FORMATS = {
	mp4: { label: "MP4", extension: "mp4", codecs: ["avc", "hevc", "av1", "vp9"] },
	webm: { label: "WebM", extension: "webm", codecs: ["vp9", "av1", "vp8"] },
} as const satisfies Record<string, { label: string; extension: string; codecs: VideoCodec[] }>;
export type VideoFormat = keyof typeof VIDEO_FORMATS;

export const VIDEO_QUALITIES = {
	medium: { label: "Medium", quality: new Quality("medium") },
	high: { label: "High", quality: new Quality("high") },
	"very-high": { label: "Very high", quality: new Quality("very-high") },
} as const satisfies Record<string, { label: string; quality: Quality }>;
export type VideoQuality = keyof typeof VIDEO_QUALITIES;

export type VideoExport = {
	format: VideoFormat;
	quality: VideoQuality;
	/** Seconds of the first frame. */
	start: number;
	/** Seconds. */
	duration: number;
	fps: number;
};

/** Encoders subsample chroma by two, so frames need even sides. */
export function videoSize({ width, height }: Size): Size {
	return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
}

export function frameCount({ duration, fps }: Pick<VideoExport, "duration" | "fps">): number {
	return Math.max(1, Math.round(duration * fps));
}

/**
 * How the encoder should read our pixels: sRGB. Videos are always exported
 * in it, BT.709's primaries being what players expect.
 */
const SAMPLE_COLOR_SPACE: VideoColorSpaceInit = {
	primaries: "bt709",
	transfer: "iec61966-2-1",
	matrix: "rgb",
	fullRange: true,
};

/**
 * Render the frames of `options` one by one, on the frame grid of its frame
 * rate whatever the playback, and encode them into a video file.
 */
export async function encodeVideo(
	preview: Preview,
	options: VideoExport,
	{
		signal,
		onProgress,
	}: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Blob> {
	const { extension, codecs } = VIDEO_FORMATS[options.format];
	const format: Mp4OutputFormat | MkvOutputFormat =
		options.format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
	const size = videoSize(preview.output.size);
	const quality = VIDEO_QUALITIES[options.quality].quality;
	const codec = await getFirstEncodableVideoCodec(
		codecs.filter((c) => format.getSupportedVideoCodecs().includes(c)),
		{ ...size, quality },
	);
	if (!codec) {
		throw new Error(`This browser can't encode ${extension.toUpperCase()} video at this size.`);
	}

	const target = new BufferTarget();
	const output = new Output({ format, target });
	const source = new VideoSampleSource({ codec, quality });
	output.addVideoTrack(source, { frameRate: options.fps });
	await output.start();

	const total = frameCount(options);
	const first = Math.round(options.start * options.fps);
	try {
		for (let i = 0; i < total; i++) {
			if (signal?.aborted) throw signal.reason;
			const frame = first + i;
			const pixels = await preview.readFrame(
				{ time: frame / options.fps, delta: 1 / options.fps, frame },
				size,
				"srgb",
			);
			const sample = new VideoSample(pixels, {
				format: "RGBX",
				codedWidth: size.width,
				codedHeight: size.height,
				timestamp: i / options.fps,
				duration: 1 / options.fps,
				colorSpace: SAMPLE_COLOR_SPACE,
			});
			await source.add(sample);
			sample.close();
			onProgress?.(i + 1, total);
		}
		await output.finalize();
	} catch (error) {
		await output.cancel();
		throw error;
	}
	if (!target.buffer) throw new Error("The video encoder produced no data.");
	return new Blob([target.buffer], { type: format.mimeType });
}

/** Download the frame shown as a PNG. */
export async function exportFrame(preview: Preview) {
	const blob = await preview.captureFrame();
	downloadFile(`frame-${String(preview.frame).padStart(5, "0")}.png`, blob);
}
