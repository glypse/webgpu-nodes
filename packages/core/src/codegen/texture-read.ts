import { isFilterable, scalarOf, type TextureFormat } from "../passes/textures";
import type { SamplerAddress, SamplerFilter } from "../types";

export const BILINEAR_FN = "texture_bilinear";

/** Linear filtering by hand, for 32-bit floats, which hardware filtering can't read. */
export const BILINEAR_SOURCE = `fn ${BILINEAR_FN}(t: texture_2d<f32>, coords: vec2f, level: i32) -> vec4f {
	let size = vec2f(textureDimensions(t, level));
	let p = coords * size - 0.5;
	let base = vec2i(floor(p));
	let f = p - floor(p);
	let hi = vec2i(size) - 1;
	let i0 = clamp(base, vec2i(0), hi);
	let i1 = clamp(base + 1, vec2i(0), hi);
	let a = textureLoad(t, i0, level);
	let b = textureLoad(t, vec2i(i1.x, i0.y), level);
	let c = textureLoad(t, vec2i(i0.x, i1.y), level);
	let d = textureLoad(t, i1, level);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

/** How a level that is a literal zero is written. */
const BASE_LEVEL = /^(0\.0|f32\(0\))$/;

export const TRILINEAR_FN = "texture_trilinear";

/** Blends the two levels around a fractional one, as a filterable texture's sampler does. */
export const TRILINEAR_SOURCE = `fn ${TRILINEAR_FN}(t: texture_2d<f32>, coords: vec2f, level: f32) -> vec4f {
	let clamped = clamp(level, 0.0, f32(textureNumLevels(t) - 1u));
	let lower = floor(clamped);
	let f = clamped - lower;
	let a = ${BILINEAR_FN}(t, coords, i32(lower));
	if (f == 0.0) {
		return a;
	}
	return mix(a, ${BILINEAR_FN}(t, coords, i32(lower) + 1), f);
}`;

/** A `textureLoad` of a texture of `format` as a `vec4f`. */
export function texelAsColor(load: string, format: TextureFormat): string {
	return scalarOf(format) === "f32" ? load : `vec4f(${load})`;
}

/**
 * A texture's value at `coords` (origin top-left, 0 to 1): sampled where
 * the format filters, else by hand: 32-bit floats bilinearly (blending the two nearest levels at a fractional one), integers
 * (which can't be interpolated) at the nearest texel. Out of range
 * coordinates are clamped, so a wrapping address is the caller's to apply
 * to the coordinates when the format can't be sampled.
 */
export function readTexture(
	texture: string,
	format: TextureFormat,
	coords: string,
	{
		filter = "linear",
		address = "clamp",
		level,
		sampler,
		define,
	}: {
		filter?: SamplerFilter;
		address?: SamplerAddress;
		/** The mip level, an f32 expression: the base level without. */
		level?: string;
		sampler: (filter: SamplerFilter, address: SamplerAddress) => string;
		define: (name: string, source: string) => string;
	},
): string {
	if (isFilterable(format)) {
		return `textureSampleLevel(${texture}, ${sampler(filter, address)}, ${coords}, ${level ?? "0.0"})`;
	}
	// A level known to be the base one needs no second read.
	if (
		scalarOf(format) === "f32" &&
		filter === "linear" &&
		level !== undefined &&
		!BASE_LEVEL.test(level)
	) {
		define(BILINEAR_FN, BILINEAR_SOURCE);
		return `${define(TRILINEAR_FN, TRILINEAR_SOURCE)}(${texture}, ${coords}, ${level})`;
	}
	// Texel reads take whole levels, which have to exist.
	const whole =
		level === undefined
			? "0"
			: `clamp(i32(round(${level})), 0, i32(textureNumLevels(${texture})) - 1)`;
	if (scalarOf(format) === "f32" && filter === "linear") {
		return `${define(BILINEAR_FN, BILINEAR_SOURCE)}(${texture}, ${coords}, ${whole})`;
	}
	const size = `vec2f(textureDimensions(${texture}, ${whole}))`;
	const load = `textureLoad(${texture}, vec2i(clamp((${coords}) * ${size}, vec2f(0.0), ${size} - 1.0)), ${whole})`;
	return texelAsColor(load, format);
}
