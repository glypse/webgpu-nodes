import {
	type Rgb,
	decodeRgb,
	encodeRgb,
	hsvToRgb,
	linearToOklch,
	oklchToLinear,
	rgbToHsv,
} from "./convert";

export const COLOR_MODES = ["rgb", "hsv", "oklch"] as const;

/**
 * What three colour components are. RGB is linear (what the shader computes
 * with); HSV is of the sRGB-encoded colour, hue in [0, 1] (as Blender); OKLch
 * has its hue in degrees.
 */
export type ColorMode = (typeof COLOR_MODES)[number];

/** Three components of a colour, in a `ColorMode`. */
export type ColorComponents = readonly [number, number, number];

/** The linear RGB of components in `mode`. */
export function colorToLinear(mode: ColorMode, [x, y, z]: ColorComponents): Rgb {
	switch (mode) {
		case "rgb":
			return { r: x, g: y, b: z };
		case "hsv":
			return decodeRgb(hsvToRgb({ h: x - Math.floor(x), s: y, v: z }));
		case "oklch":
			return oklchToLinear({ l: x, c: y, h: z });
	}
}

/**
 * The components in `mode` of a linear RGB colour. A hue that doesn't show
 * (grey, black) is `turns` instead, so it survives going through them.
 */
export function linearToColor(mode: ColorMode, rgb: Rgb, turns = 0): ColorComponents {
	switch (mode) {
		case "rgb":
			return [rgb.r, rgb.g, rgb.b];
		case "hsv": {
			const { h, s, v } = rgbToHsv(encodeRgb(rgb));
			return [s > 0 && v > 0 ? h : turns, s, v];
		}
		case "oklch": {
			const { l, c, h } = linearToOklch(rgb);
			return c < 1e-4 ? [l, 0, turns * 360] : [l, c, h];
		}
	}
}

/** The same colour's components in another mode, keeping a hidden hue. */
export function convertColorMode(
	from: ColorMode,
	to: ColorMode,
	components: ColorComponents,
): ColorComponents {
	const [x, , z] = components;
	const turns = from === "hsv" ? x : from === "oklch" ? z / 360 : 0;
	return linearToColor(to, colorToLinear(from, components), turns);
}
