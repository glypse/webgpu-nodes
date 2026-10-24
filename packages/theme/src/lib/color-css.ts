import { encodeRgb, type Rgb, type Rgba } from "$core";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A CSS colour showing an (encoded) RGB colour, clipped to the display's range. */
export function rgbToCss({ r, g, b }: Rgb, alpha = 1): string {
	const byte = (n: number) => Math.round(clamp01(n) * 255);
	return `rgb(${String(byte(r))} ${String(byte(g))} ${String(byte(b))} / ${String(clamp01(alpha))})`;
}

/** A CSS colour showing a linear colour. */
export function linearToCss(color: Rgba): string {
	return rgbToCss(encodeRgb(color), color.a);
}
