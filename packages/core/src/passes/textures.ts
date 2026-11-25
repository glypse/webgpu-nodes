import type { FrameRef } from "../frame/program";

export const TEXTURE_FORMATS = [
	"rgba16float",
	"rg16float",
	"r16float",
	"rgba32float",
	"rg32float",
	"r32float",
	"rgba8unorm",
	"rgba32uint",
	"rg32uint",
	"r32uint",
	"rgba32sint",
	"rg32sint",
	"r32sint",
] as const;
export type TextureFormat = (typeof TEXTURE_FORMATS)[number];

/** A frame value as plans carry it: a literal, or a value of the plan's frame program. */
export type FrameArg = number | { frame: FrameRef };

/** A size: a scale of the canvas or of another resource, or pixels. */
export type TextureSize =
	| { kind: "scale"; scale: FrameArg; of: "canvas" | { resource: string } }
	| { kind: "pixels"; width: FrameArg; height: FrameArg };

export type Size = { width: number; height: number };

/** What sizes are resolved against. */
export type SizeEnv = {
	canvas: Size;
	/** The current size of a resource, which must already be known. */
	resource: (id: string) => Size | undefined;
	/** WebGPU's `maxTextureDimension2D`. */
	maxDimension?: number;
	/** The value of a frame program's output, which sizes made of frame values need. */
	frame?: (ref: FrameRef) => number;
};

/** The canvas' own size. */
export const CANVAS_SIZE: TextureSize = { kind: "scale", scale: 1, of: "canvas" };

/** What a texture of any format is read as by a shader. */
export type TextureSampleType = "float" | "unfilterable-float" | "sint" | "uint";

const FILTERABLE: ReadonlySet<TextureFormat> = new Set([
	"rgba16float",
	"rg16float",
	"r16float",
	"rgba8unorm",
]);

/**
 * Formats WebGPU can write as storage textures without optional features;
 * the half floats of one and two channels can't.
 */
const STORAGE: ReadonlySet<TextureFormat> = new Set(
	TEXTURE_FORMATS.filter((f) => f !== "rg16float" && f !== "r16float"),
);

/**
 * Whether linear filtering reads it. 32-bit floats aren't without the
 * optional `float32-filterable` feature, which codegen can't count on.
 */
export function isFilterable(format: TextureFormat): boolean {
	return FILTERABLE.has(format);
}

/** The scalar a format's texels are read and written as. */
export function scalarOf(format: TextureFormat): "f32" | "i32" | "u32" {
	if (format.endsWith("sint")) return "i32";
	if (format.endsWith("uint")) return "u32";
	return "f32";
}

export function sampleTypeOf(format: TextureFormat): TextureSampleType {
	switch (scalarOf(format)) {
		case "i32":
			return "sint";
		case "u32":
			return "uint";
		default:
			return isFilterable(format) ? "float" : "unfilterable-float";
	}
}

/** Whether a pass can draw into it (all of them can, without blending). */
export function isRenderable(format: TextureFormat): boolean {
	return TEXTURE_FORMATS.includes(format);
}

/** Whether a compute pass can write it as a storage texture. */
export function isStorage(format: TextureFormat): boolean {
	return STORAGE.has(format);
}

/** Whether it can have mip levels: integers can't be averaged. */
export function canMip(format: TextureFormat): boolean {
	return scalarOf(format) === "f32";
}

/** How many levels a full mip chain of a texture of this size has. */
/**
 * The texels of an axis of `size` texels that texel `i` of the next level
 * takes, as a first texel and one weight for it and each after, which sum to
 * one. Even sizes take pairs; an odd size, 2m + 1, takes three for each, the
 * outer two partly. The runtime's mip shader averages with these same weights.
 */
export function mipWeights(size: number, i: number): { first: number; weights: number[] } {
	if (size === 1) return { first: 0, weights: [1] };
	if (size % 2 === 0) return { first: 2 * i, weights: [0.5, 0.5] };
	const m = (size - 1) / 2;
	return { first: 2 * i, weights: [(m - i) / size, m / size, (i + 1) / size] };
}

export function mipLevelCount({ width, height }: Size): number {
	return Math.floor(Math.log2(Math.max(width, height, 1))) + 1;
}

/** How many components its texels have. */
export function channelsOf(format: TextureFormat): 1 | 2 | 4 {
	if (format.startsWith("rgba")) return 4;
	return format.startsWith("rg") ? 2 : 1;
}

/** The bytes a texel takes: among a pass's colour attachments, and in memory. */
export function texelBytes(format: TextureFormat): number {
	const bytes = format.includes("16") ? 2 : format.includes("32") ? 4 : 1;
	return channelsOf(format) * bytes;
}

/**
 * Whether two sizes are provably the same. Only equality it can see:
 * the same base with the same literal scale, or the same pixels.
 */
export function sameSize(a: TextureSize, b: TextureSize): boolean {
	if (a.kind === "pixels" || b.kind === "pixels") {
		return (
			a.kind === "pixels" &&
			b.kind === "pixels" &&
			sameArg(a.width, b.width) &&
			sameArg(a.height, b.height)
		);
	}
	const sameBase =
		a.of === b.of ||
		(typeof a.of === "object" && typeof b.of === "object" && a.of.resource === b.of.resource);
	return sameBase && sameArg(a.scale, b.scale);
}

/** Whether two frame arguments are the same literal or the same value of the frame program. */
export function sameArg(a: FrameArg, b: FrameArg): boolean {
	if (typeof a === "number" || typeof b === "number") return a === b;
	return (
		a.frame.step === b.frame.step &&
		a.frame.output === b.frame.output &&
		(a.frame.component ?? 0) === (b.frame.component ?? 0)
	);
}

/** Whether `size` is the canvas' own. */
export function isCanvasSize(size: TextureSize): boolean {
	return size.kind === "scale" && size.of === "canvas" && size.scale === 1;
}

/** Rounds up, ignoring the error of products like `1000 * 0.1`. */
function pixels(value: number, max: number): number {
	return Math.min(Math.max(1, Math.ceil(value - 1e-6)), max);
}

/**
 * The size in pixels: `max(1, ceil(dimension * scale))`, so every texel is
 * covered (a 1001-pixel side has 126 blocks of 8), clamped to the device's
 * limit.
 */
export function resolveSize(size: TextureSize, env: SizeEnv): Size {
	const max = env.maxDimension ?? Infinity;
	const arg = (value: FrameArg): number => {
		if (typeof value === "number") return value;
		if (!env.frame) throw new Error("A size reads a frame value, but none were computed.");
		return env.frame(value.frame);
	};
	if (size.kind === "pixels") {
		return { width: pixels(arg(size.width), max), height: pixels(arg(size.height), max) };
	}
	const scale = arg(size.scale);
	let base: Size | undefined = env.canvas;
	if (size.of !== "canvas") {
		base = env.resource(size.of.resource);
		if (!base) throw new Error(`Unknown resource "${size.of.resource}" in a size.`);
	}
	return {
		width: pixels(base.width * scale, max),
		height: pixels(base.height * scale, max),
	};
}
