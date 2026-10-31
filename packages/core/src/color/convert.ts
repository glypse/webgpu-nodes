import type { ColorSpace } from "../graph/settings";
import { clipToGamut, fromGamut, toGamut } from "./display";

/**
 * Colour conversions. Colours are held as linear sRGB (what shaders compute
 * with), components unbounded above for HDR and below for colours past sRGB;
 * HSV is of the sRGB-encoded colour, as Blender shows it, and hex and
 * on-screen swatches are encoded in the colour space shown.
 */

export type Rgb = { r: number; g: number; b: number };
export type Rgba = Rgb & { a: number };
/** Hue, saturation and value in [0, 1]. */
export type Hsv = { h: number; s: number; v: number };
/** OKLch: lightness in [0, 1], chroma (about [0, 0.37] in sRGB), hue in degrees. */
export type Lch = { l: number; c: number; h: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function srgbEncode(linear: number): number {
	const c = Math.max(0, linear);
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function srgbDecode(encoded: number): number {
	const c = Math.max(0, encoded);
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function encodeRgb({ r, g, b }: Rgb): Rgb {
	return { r: srgbEncode(r), g: srgbEncode(g), b: srgbEncode(b) };
}

/** A linear sRGB colour, gamma-encoded in `space` (whose transfer curve is sRGB's). */
export function encodeIn(color: Rgb, space: ColorSpace): Rgb {
	return encodeRgb(toGamut(color, space));
}

/** The linear sRGB colour of one gamma-encoded in `space`. */
export function decodeFrom(color: Rgb, space: ColorSpace): Rgb {
	return fromGamut(decodeRgb(color), space);
}

export function decodeRgb({ r, g, b }: Rgb): Rgb {
	return { r: srgbDecode(r), g: srgbDecode(g), b: srgbDecode(b) };
}

/** HSV of an (encoded) RGB colour, clamped to [0, 1] first. */
export function rgbToHsv(rgb: Rgb): Hsv {
	const r = clamp01(rgb.r);
	const g = clamp01(rgb.g);
	const b = clamp01(rgb.b);
	const max = Math.max(r, g, b);
	const delta = max - Math.min(r, g, b);
	let h = 0;
	if (delta > 0) {
		if (max === r) h = ((g - b) / delta + 6) % 6;
		else if (max === g) h = (b - r) / delta + 2;
		else h = (r - g) / delta + 4;
	}
	return { h: h / 6, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
	const sector = (((h % 1) + 1) % 1) * 6;
	const channel = (n: number) => {
		const k = (n + sector) % 6;
		return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
	};
	return { r: channel(5), g: channel(3), b: channel(1) };
}

type Lab = [number, number, number];

/** Björn Ottosson's OKLab of a linear RGB colour. */
function linearToOklab({ r, g, b }: Rgb): Lab {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

/** Linear RGB of an OKLab colour, outside [0, 1] when out of the sRGB gamut. */
function oklabToLinear([L, A, B]: Lab): Rgb {
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return {
		r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	};
}

const oklchToOklab = (l: number, c: number, h: number): Lab => {
	const rad = (h * Math.PI) / 180;
	return [l, c * Math.cos(rad), c * Math.sin(rad)];
};

/** Linear RGB of an OKLch colour as is: outside [0, 1] when out of the sRGB gamut. */
export function oklchToLinearUnmapped({ l, c, h }: Lch): Rgb {
	return oklabToLinear(oklchToOklab(l, c, h));
}

/** OKLch of a linear RGB colour. */
export function linearToOklch(rgb: Rgb): Lch {
	const [L, A, B] = linearToOklab(rgb);
	const hue = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c: Math.hypot(A, B), h: (hue + 360) % 360 };
}

/**
 * Linear sRGB of an OKLch colour, mapped into `space`'s gamut as CSS Color 4
 * does (and the standard library's OKLch Gamut Map group): lightness and hue
 * kept, chroma lowered until the colour fits or its clip is less than a just
 * noticeable difference away. Clipping each channel instead shifts hue and
 * lightness.
 */
export function oklchToLinear({ l, c, h }: Lch, space: ColorSpace = "srgb"): Rgb {
	const JND = 0.02;
	if (l >= 1) return { r: 1, g: 1, b: 1 };
	if (l <= 0) return { r: 0, g: 0, b: 0 };
	const clip = (rgb: Rgb): Rgb => clipToGamut(rgb, space);
	const offBy = (lab: Lab, clipped: Rgb) => {
		const [L, A, B] = linearToOklab(clipped);
		return Math.hypot(L - lab[0], A - lab[1], B - lab[2]);
	};
	const inGamut = (rgb: Rgb) => {
		const clipped = clip(rgb);
		return Math.hypot(rgb.r - clipped.r, rgb.g - clipped.g, rgb.b - clipped.b) <= 1e-5;
	};
	const origin = oklchToOklab(l, c, h);
	const originClip = clip(oklabToLinear(origin));
	if (offBy(origin, originClip) < JND) return originClip;
	let low = 0;
	let high = c;
	let lowInGamut = true;
	for (let i = 0; i < 16; i++) {
		const mid = (low + high) / 2;
		const lab = oklchToOklab(l, mid, h);
		const rgb = oklabToLinear(lab);
		const fits = inGamut(rgb);
		const near = offBy(lab, clip(rgb)) < JND;
		if ((lowInGamut && fits) || near) {
			lowInGamut &&= fits || !near;
			low = mid;
		} else {
			high = mid;
		}
	}
	return clip(oklabToLinear(oklchToOklab(l, low, h)));
}

const hexByte = (n: number) =>
	Math.round(clamp01(n) * 255)
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();

/** `#RRGGBB` (or `#RRGGBBAA` with `alpha`) of a linear colour, encoded in `space`. */
export function linearToHex(color: Rgba, alpha: boolean, space: ColorSpace = "srgb"): string {
	const { r, g, b } = encodeIn(color, space);
	return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${alpha ? hexByte(color.a) : ""}`;
}

/**
 * The linear colour of a hex string (`#RGB`, `#RGBA`, `#RRGGBB` or
 * `#RRGGBBAA`, `#` optional) encoded in `space`, or undefined if it isn't one.
 */
export function hexToLinear(hex: string, space: ColorSpace = "srgb"): Rgba | undefined {
	let digits = hex.trim().replace(/^#/, "");
	if (!/^[\da-f]+$/i.test(digits)) return undefined;
	if (digits.length === 3 || digits.length === 4) {
		digits = digits.replace(/./g, "$&$&");
	}
	if (digits.length !== 6 && digits.length !== 8) return undefined;
	const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
	return {
		...decodeFrom({ r: byte(0), g: byte(2), b: byte(4) }, space),
		a: digits.length === 8 ? byte(6) : 1,
	};
}

const GREY = 1e-6;

/**
 * HSV (of the sRGB-encoded colour) of a linear one, keeping `previous`'s
 * hue for a grey and its hue and saturation for black, which have none: so
 * a hue survives going through them, as in Blender.
 */
export function hsvKeepingHue(color: Rgb, previous: Hsv): Hsv {
	const next = rgbToHsv(encodeRgb(color));
	if (next.v < GREY) return { ...previous, v: 0 };
	return next.s < GREY ? { ...next, h: previous.h } : next;
}

/** OKLch of a linear colour, keeping `previous`'s hue for a grey, which has none. */
export function lchKeepingHue(color: Rgb, previous: Lch): Lch {
	const next = linearToOklch(color);
	return next.c < 1e-4 ? { ...next, c: 0, h: previous.h } : next;
}
