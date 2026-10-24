/**
 * Colour conversions. Colours are held as linear RGB
 * (what shaders compute with), components unbounded above for HDR; hex, HSV
 * and on-screen swatches are sRGB-encoded, as Blender shows them.
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

/** OKLch of a linear RGB colour (Björn Ottosson's OKLab). */
export function linearToOklch({ r, g, b }: Rgb): Lch {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const hue = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c: Math.hypot(A, B), h: (hue + 360) % 360 };
}

/** Linear RGB of an OKLch colour; components outside the sRGB gamut are clipped at 0. */
export function oklchToLinear({ l: L, c, h }: Lch): Rgb {
	const rad = (h * Math.PI) / 180;
	const A = c * Math.cos(rad);
	const B = c * Math.sin(rad);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return {
		r: Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	};
}

const hexByte = (n: number) =>
	Math.round(clamp01(n) * 255)
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();

/** `#RRGGBB` (or `#RRGGBBAA` with `alpha`) of a linear colour, sRGB-encoded. */
export function linearToHex(color: Rgba, alpha: boolean): string {
	const { r, g, b } = encodeRgb(color);
	return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${alpha ? hexByte(color.a) : ""}`;
}

/**
 * The linear colour of a hex string (`#RGB`, `#RGBA`, `#RRGGBB` or
 * `#RRGGBBAA`, `#` optional), or undefined if it isn't one.
 */
export function hexToLinear(hex: string): Rgba | undefined {
	let digits = hex.trim().replace(/^#/, "");
	if (!/^[\da-f]+$/i.test(digits)) return undefined;
	if (digits.length === 3 || digits.length === 4) {
		digits = digits.replace(/./g, "$&$&");
	}
	if (digits.length !== 6 && digits.length !== 8) return undefined;
	const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
	return {
		...decodeRgb({ r: byte(0), g: byte(2), b: byte(4) }),
		a: digits.length === 8 ? byte(6) : 1,
	};
}
