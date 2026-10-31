import type { ColorSpace } from "../graph/settings";
import type { Rgb } from "./convert";

/** A 3×3 matrix, row by row. */
export type Mat3 = readonly [
	readonly [number, number, number],
	readonly [number, number, number],
	readonly [number, number, number],
];

// Between linear sRGB and linear Display P3, both D65: CSS Color 4's
// rational matrices through XYZ, multiplied out.
export const SRGB_TO_DISPLAY_P3: Mat3 = [
	[0.822461969, 0.177538031, 0],
	[0.033194199, 0.966805801, 0],
	[0.017082631, 0.072397441, 0.910519929],
];
export const DISPLAY_P3_TO_SRGB: Mat3 = [
	[1.224940176, -0.224940176, 0],
	[-0.042056955, 1.042056955, 0],
	[-0.019637555, -0.078636046, 1.0982736],
];

/** `m` as a WGSL `mat3x3f`, whose constructor takes columns. */
export function wgslMat3(m: Mat3): string {
	const column = (i: number) => `vec3f(${m.map((row) => row[i]?.toFixed(9)).join(", ")})`;
	return `mat3x3f(${column(0)}, ${column(1)}, ${column(2)})`;
}

function apply(m: Mat3, { r, g, b }: Rgb): Rgb {
	const [x, y, z] = m.map((row) => row[0] * r + row[1] * g + row[2] * b);
	return { r: x ?? 0, g: y ?? 0, b: z ?? 0 };
}

/** A linear sRGB colour as linear RGB of `space`'s primaries. */
export function toGamut(rgb: Rgb, space: ColorSpace): Rgb {
	return space === "srgb" ? rgb : apply(SRGB_TO_DISPLAY_P3, rgb);
}

/** A linear RGB colour of `space`'s primaries as linear sRGB. */
export function fromGamut(rgb: Rgb, space: ColorSpace): Rgb {
	return space === "srgb" ? rgb : apply(DISPLAY_P3_TO_SRGB, rgb);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clip = ({ r, g, b }: Rgb): Rgb => ({ r: clamp01(r), g: clamp01(g), b: clamp01(b) });

/**
 * A linear sRGB colour with each channel clamped to `space`'s gamut, still in
 * linear sRGB: components outside [0, 1] are what Display P3 adds to sRGB.
 */
export function clipToGamut(rgb: Rgb, space: ColorSpace): Rgb {
	return fromGamut(clip(toGamut(rgb, space)), space);
}

/** Whether a linear sRGB colour is within `space`'s gamut, up to rounding. */
export function inGamut(rgb: Rgb, space: ColorSpace): boolean {
	const EPSILON = 1e-5;
	const { r, g, b } = toGamut(rgb, space);
	return [r, g, b].every((n) => n >= -EPSILON && n <= 1 + EPSILON);
}
