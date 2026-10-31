// The reference for colour tests: CSS Color 4's conversions and gamut
// mapping, as its sample code writes them.

export type V = [number, number, number];
type M = [V, V, V];
const mul = (m: M, v: V): V => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as V;

// CSS Color 4 sample code (conversions.js), independent of the matrices
// the library and the colour picker use.
const LIN_SRGB_TO_XYZ: M = [
	[506752 / 1228815, 87881 / 245763, 12673 / 70218],
	[87098 / 409605, 175762 / 245763, 12673 / 175545],
	[7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LIN_SRGB: M = [
	[12831 / 3959, -329 / 214, -1974 / 3959],
	[-851781 / 878810, 1648619 / 878810, 36519 / 878810],
	[705 / 12673, -2585 / 12673, 705 / 667],
];
const LIN_P3_TO_XYZ: M = [
	[608311 / 1250200, 189793 / 714400, 198249 / 1000160],
	[35783 / 156275, 247089 / 357200, 198249 / 2500400],
	[0 / 1, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_LIN_P3: M = [
	[446124 / 178915, -333277 / 357830, -72051 / 178915],
	[-14852 / 17905, 63121 / 35810, 423 / 17905],
	[11844 / 330415, -50337 / 660830, 316169 / 330415],
];
const XYZ_TO_LMS: M = [
	[0.819022437996703, 0.3619062600528904, -0.1288737815209879],
	[0.0329836539323885, 0.929286861586343, 0.0361446663506424],
	[0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB: M = [
	[0.210454268309314, 0.7936177747023054, -0.0040720430116193],
	[1.9779985324311684, -2.42859224204858, 0.450593709617411],
	[0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ: M = [
	[1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
	[-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
	[-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const OKLAB_TO_LMS: M = [
	[1, 0.3963377773761749, 0.2158037573099136],
	[1, -0.1055613458156586, -0.0638541728258133],
	[1, -0.0894841775298119, -1.2914855480194092],
];

export const gam = (c: number) =>
	Math.abs(c) <= 0.0031308
		? 12.92 * c
		: Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);
export const lin = (c: number) =>
	Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4;

export const oklchToOklab = ([l, c, h]: V): V => [
	l,
	c * Math.cos((h * Math.PI) / 180),
	c * Math.sin((h * Math.PI) / 180),
];
export const oklabToLinear = (lab: V): V =>
	mul(XYZ_TO_LIN_SRGB, mul(LMS_TO_XYZ, mul(OKLAB_TO_LMS, lab).map((x) => x ** 3) as V));
export const linearToOklab = (rgb: V): V =>
	mul(LMS_TO_OKLAB, mul(XYZ_TO_LMS, mul(LIN_SRGB_TO_XYZ, rgb)).map(Math.cbrt) as V);
/** Linear Display P3 of a linear sRGB colour. */
export const linearToP3 = (rgb: V): V => mul(XYZ_TO_LIN_P3, mul(LIN_SRGB_TO_XYZ, rgb));
/** Linear sRGB of a linear Display P3 colour. */
export const p3ToLinear = (p3: V): V => mul(XYZ_TO_LIN_SRGB, mul(LIN_P3_TO_XYZ, p3));

export type Gamut = "srgb" | "display-p3";
export const deltaEOK = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * An OKLch colour mapped into `gamut` as CSS Color 4 §13.2 says, as that
 * gamut's gamma-encoded RGB.
 */
export function cssGamutMap([L, C, H]: V, gamut: Gamut = "srgb"): V {
	const toGamut = (rgb: V) => (gamut === "srgb" ? rgb : linearToP3(rgb));
	const fromGamut = (rgb: V) => (gamut === "srgb" ? rgb : p3ToLinear(rgb));
	const encoded = (lch: V) => toGamut(oklabToLinear(oklchToOklab(lch))).map(gam) as V;
	const clip = (rgb: V) => rgb.map((x) => Math.min(1, Math.max(0, x))) as V;
	const inGamut = (rgb: V) => rgb.every((x) => x >= -1e-6 && x <= 1 + 1e-6);
	const okOf = (rgb: V) => linearToOklab(fromGamut(rgb.map(lin) as V));
	if (L >= 1) return [1, 1, 1];
	if (L <= 0) return [0, 0, 0];
	if (inGamut(encoded([L, C, H]))) return encoded([L, C, H]);
	const JND = 0.02;
	const eps = 0.0001;
	let current: V = [L, C, H];
	let clipped = clip(encoded(current));
	let E = deltaEOK(okOf(clipped), oklchToOklab(current));
	if (E < JND) return clipped;
	let min = 0;
	let max = C;
	let minInGamut = true;
	while (max - min > eps) {
		const chroma = (min + max) / 2;
		current = [L, chroma, H];
		if (minInGamut && inGamut(encoded(current))) {
			min = chroma;
			continue;
		}
		clipped = clip(encoded(current));
		E = deltaEOK(okOf(clipped), oklchToOklab(current));
		if (E < JND) {
			if (JND - E < eps) return clipped;
			minInGamut = false;
			min = chroma;
		} else {
			max = chroma;
		}
	}
	return clipped;
}
