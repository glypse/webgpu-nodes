import { type ColorSpace, encodeIn, type Rgb, type Rgba } from "$core";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A CSS colour showing an RGB colour encoded in `space`, clipped to its
 * gamut.
 */
export function rgbToCss({ r, g, b }: Rgb, alpha = 1, space: ColorSpace = "srgb"): string {
	const a = String(clamp01(alpha));
	if (space === "display-p3") {
		const n = (c: number) => String(clamp01(c));
		return `color(display-p3 ${n(r)} ${n(g)} ${n(b)} / ${a})`;
	}
	const byte = (n: number) => Math.round(clamp01(n) * 255);
	return `rgb(${String(byte(r))} ${String(byte(g))} ${String(byte(b))} / ${a})`;
}

/** A CSS colour showing a linear sRGB colour in `space`. */
export function linearToCss(color: Rgba, space: ColorSpace = "srgb"): string {
	return rgbToCss(encodeIn(color, space), color.a, space);
}
