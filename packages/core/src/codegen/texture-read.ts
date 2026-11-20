import { isFilterable, scalarOf, type TextureFormat } from "../passes/textures";
import type { SamplerAddress, SamplerFilter } from "../types";

export const BILINEAR_FN = "texture_bilinear";

/** Linear filtering by hand, for 32-bit floats, which hardware filtering can't read. */
export const BILINEAR_SOURCE = `fn ${BILINEAR_FN}(t: texture_2d<f32>, coords: vec2f) -> vec4f {
	let size = vec2f(textureDimensions(t));
	let p = coords * size - 0.5;
	let base = vec2i(floor(p));
	let f = p - floor(p);
	let hi = vec2i(size) - 1;
	let i0 = clamp(base, vec2i(0), hi);
	let i1 = clamp(base + 1, vec2i(0), hi);
	let a = textureLoad(t, i0, 0);
	let b = textureLoad(t, vec2i(i1.x, i0.y), 0);
	let c = textureLoad(t, vec2i(i0.x, i1.y), 0);
	let d = textureLoad(t, i1, 0);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

/** A `textureLoad` of a texture of `format` as a `vec4f`. */
export function texelAsColor(load: string, format: TextureFormat): string {
	return scalarOf(format) === "f32" ? load : `vec4f(${load})`;
}

/**
 * A texture's value at `coords` (origin top-left, 0 to 1): sampled where
 * the format filters, else by hand: 32-bit floats bilinearly, integers
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
		sampler,
		define,
	}: {
		filter?: SamplerFilter;
		address?: SamplerAddress;
		sampler: (filter: SamplerFilter, address: SamplerAddress) => string;
		define: (name: string, source: string) => string;
	},
): string {
	if (isFilterable(format)) {
		return `textureSampleLevel(${texture}, ${sampler(filter, address)}, ${coords}, 0.0)`;
	}
	if (scalarOf(format) === "f32" && filter === "linear") {
		return `${define(BILINEAR_FN, BILINEAR_SOURCE)}(${texture}, ${coords})`;
	}
	const size = `vec2f(textureDimensions(${texture}))`;
	const load = `textureLoad(${texture}, vec2i(clamp((${coords}) * ${size}, vec2f(0.0), ${size} - 1.0)), 0)`;
	return texelAsColor(load, format);
}
