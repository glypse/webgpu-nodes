// Colour spaces (linear RGB, XYZ, OKLab, OKLch), gamut mapping and the Color
// group they serve, after Björn Ottosson's OKLab and CSS Color 4.
import { group, type GroupBuilder, type Ref } from "../builder";

type Row = { x: number; y: number; z: number };
type Matrix = readonly [Row, Row, Row];

/** `v` through `matrix`, a row at a time. */
function transform(g: GroupBuilder, v: Ref, matrix: Matrix): Ref {
	const [x, y, z] = matrix;
	return g.vec("vec3f", g.dot(v, x), g.dot(v, y), g.dot(v, z));
}

/** `v` to the power of `exponent`, keeping each component's sign. */
function signedPow(g: GroupBuilder, v: Ref, exponent: number): Ref {
	return g.mul(g.sign(v), g.pow(g.abs(v), exponent));
}

const LINEAR_RGB_TO_XYZ: Matrix = [
	{ x: 0.4123907993, y: 0.3575843394, z: 0.1804807884 },
	{ x: 0.2126390059, y: 0.7151686788, z: 0.0721923054 },
	{ x: 0.0193308187, y: 0.1191947798, z: 0.9505321522 },
];
const XYZ_TO_LINEAR_RGB: Matrix = [
	{ x: 3.2409699419, y: -1.5373831776, z: -0.4986107603 },
	{ x: -0.9692436363, y: 1.8759675015, z: 0.0415550574 },
	{ x: 0.0556300797, y: -0.2039769589, z: 1.0569715142 },
];
const XYZ_TO_LMS: Matrix = [
	{ x: 0.8190224432, y: 0.3619062563, z: -0.1288737826 },
	{ x: 0.0329836672, y: 0.9292868469, z: 0.0361446682 },
	{ x: 0.0481771996, y: 0.2642395249, z: 0.6335478258 },
];
const LMS_TO_XYZ: Matrix = [
	{ x: 1.2268798737, y: -0.5578149969, z: 0.2813910503 },
	{ x: -0.0405757627, y: 1.1122868365, z: -0.0717110837 },
	{ x: -0.0763729496, y: -0.4214933241, z: 1.5869240244 },
];
const LINEAR_RGB_TO_LMS: Matrix = [
	{ x: 0.4122214708, y: 0.5363325363, z: 0.0514459929 },
	{ x: 0.2119034982, y: 0.6806995451, z: 0.1073969566 },
	{ x: 0.0883024619, y: 0.2817188376, z: 0.6299787005 },
];
const LMS_TO_LINEAR_RGB: Matrix = [
	{ x: 4.0767416621, y: -3.3077115913, z: 0.2309699292 },
	{ x: -1.2684380046, y: 2.6097574011, z: -0.3413193965 },
	{ x: -0.0041960863, y: -0.7034186147, z: 1.707614701 },
];
const LMS_TO_OKLAB: Matrix = [
	{ x: 0.2104542553, y: 0.793617785, z: -0.0040720468 },
	{ x: 1.9779984951, y: -2.428592205, z: 0.4505937099 },
	{ x: 0.0259040371, y: 0.7827717662, z: -0.808675766 },
];
const OKLAB_TO_LMS: Matrix = [
	{ x: 1, y: 0.3963377774, z: 0.2158037573 },
	{ x: 1, y: -0.1055613458, z: -0.0638541728 },
	{ x: 1, y: -0.0894841775, z: -1.291485548 },
];

const CONVERSION = ["Color Space Conversion"];

const linearRgbToXyz = group({
	id: "std-linear-rgb-to-xyz",
	inputs: ["rgb"],
	outputs: ["xyz"],
	name: "Linear RGB to XYZ",
	aliases: ["sRGB to XYZ", "RGB to XYZ", ...CONVERSION],
	category: "color",
	build: (g) => {
		const rgb = g.input("rgb", "vec3f", { label: "Linear RGB" });
		g.output("xyz", transform(g, rgb, LINEAR_RGB_TO_XYZ), "vec3f", { label: "XYZ" });
	},
});

const xyzToLinearRgb = group({
	id: "std-xyz-to-linear-rgb",
	inputs: ["xyz"],
	outputs: ["rgb"],
	name: "XYZ to Linear RGB",
	aliases: ["XYZ to sRGB", "XYZ to RGB", ...CONVERSION],
	category: "color",
	build: (g) => {
		const xyz = g.input("xyz", "vec3f", { label: "XYZ" });
		g.output("rgb", transform(g, xyz, XYZ_TO_LINEAR_RGB), "vec3f", { label: "Linear RGB" });
	},
});

/** To OKLab from a space `toLms` takes to the cones' responses (LMS). */
function toOklab(g: GroupBuilder, from: Ref, toLms: Matrix, space: string): Ref {
	const lms = g.frame("LMS", { note: `The cones' responses to the ${space} colour.` }, () =>
		transform(g, from, toLms),
	);
	const compressed = g.frame(
		"Cube root",
		{ note: "Compressed the way perception is (signed, for colours out of gamut)." },
		() => signedPow(g, lms, 1 / 3),
	);
	return g.frame(
		"OKLab",
		{ note: "Lightness, then green–red and blue–yellow, from the compressed responses." },
		() => transform(g, compressed, LMS_TO_OKLAB),
	);
}

/** From OKLab to a space `fromLms` takes the cones' responses (LMS) to. */
function fromOklab(g: GroupBuilder, lab: Ref, fromLms: Matrix, space: string): Ref {
	const compressed = g.frame(
		"Compressed LMS",
		{ note: "The cones' compressed responses the OKLab colour is made of." },
		() => transform(g, lab, OKLAB_TO_LMS),
	);
	const lms = g.frame("Cube", { note: "Uncompressed (signed, for colours out of gamut)." }, () =>
		signedPow(g, compressed, 3),
	);
	return g.frame("To " + space, { note: `The ${space} colour giving those responses.` }, () =>
		transform(g, lms, fromLms),
	);
}

const xyzToOklab = group({
	id: "std-xyz-to-oklab",
	inputs: ["xyz"],
	outputs: ["oklab"],
	name: "XYZ to OKLab",
	aliases: [...CONVERSION, "Perceptual Color"],
	category: "color",
	build: (g) => {
		const xyz = g.input("xyz", "vec3f", { label: "XYZ" });
		g.output("oklab", toOklab(g, xyz, XYZ_TO_LMS, "XYZ"), "vec3f", { label: "OKLab" });
	},
});

const oklabToXyz = group({
	id: "std-oklab-to-xyz",
	inputs: ["oklab"],
	outputs: ["xyz"],
	name: "OKLab to XYZ",
	aliases: [...CONVERSION, "Perceptual Color"],
	category: "color",
	build: (g) => {
		const lab = g.input("oklab", "vec3f", { label: "OKLab" });
		g.output("xyz", fromOklab(g, lab, LMS_TO_XYZ, "XYZ"), "vec3f", { label: "XYZ" });
	},
});

const linearRgbToOklab = group({
	id: "std-linear-rgb-to-oklab",
	inputs: ["rgb"],
	outputs: ["oklab"],
	name: "Linear RGB to OKLab",
	aliases: ["sRGB to OKLab", "RGB to OKLab", ...CONVERSION, "Perceptual Color"],
	category: "color",
	build: (g) => {
		const rgb = g.input("rgb", "vec3f", { label: "Linear RGB" });
		g.output("oklab", toOklab(g, rgb, LINEAR_RGB_TO_LMS, "linear RGB"), "vec3f", {
			label: "OKLab",
		});
	},
});

const oklabToLinearRgb = group({
	id: "std-oklab-to-linear-rgb",
	inputs: ["oklab"],
	outputs: ["rgb"],
	name: "OKLab to Linear RGB",
	aliases: ["OKLab to sRGB", "OKLab to RGB", ...CONVERSION, "Perceptual Color"],
	category: "color",
	build: (g) => {
		const lab = g.input("oklab", "vec3f", { label: "OKLab" });
		g.output("rgb", fromOklab(g, lab, LMS_TO_LINEAR_RGB, "linear RGB"), "vec3f", {
			label: "Linear RGB",
		});
	},
});

const oklabToOklch = group({
	id: "std-oklab-to-oklch",
	inputs: ["oklab"],
	outputs: ["oklch"],
	name: "OKLab to OKLch",
	aliases: ["Lab to LCh", "Polar", ...CONVERSION],
	category: "color",
	build: (g) => {
		const lab = g.input("oklab", "vec3f", { label: "OKLab" });
		const { x: lightness, y: a, z: b } = g.separateVector(lab);
		const chroma = g.frame("Chroma", { note: "How far from grey: the length of (a, b)." }, () =>
			g.length(g.vec("vec2f", a, b)),
		);
		const hue = g.frame("Hue", { note: "The angle of (a, b), in degrees from 0 to 360." }, () =>
			g.mul(g.fract(g.mul(g.atan2(b, a), 1 / (2 * Math.PI))), 360),
		);
		g.output("oklch", g.vec("vec3f", lightness, chroma, hue), "vec3f", { label: "OKLch" });
	},
});

const oklchToOklab = group({
	id: "std-oklch-to-oklab",
	inputs: ["oklch"],
	outputs: ["oklab"],
	name: "OKLch to OKLab",
	aliases: ["LCh to Lab", "Polar", ...CONVERSION],
	category: "color",
	build: (g) => {
		const lch = g.input("oklch", "vec3f", { label: "OKLch" });
		const { x: lightness, y: chroma, z: hue } = g.separateVector(lch);
		const { a, b } = g.frame(
			"a and b",
			{ note: "Chroma along the hue's direction (hue in degrees)." },
			() => {
				const radians = g.mul(hue, Math.PI / 180);
				return { a: g.mul(chroma, g.cos(radians)), b: g.mul(chroma, g.sin(radians)) };
			},
		);
		g.output("oklab", g.vec("vec3f", lightness, a, b), "vec3f", { label: "OKLab" });
	},
});

const linearRgbToOklch = group({
	id: "std-linear-rgb-to-oklch",
	inputs: ["rgb"],
	outputs: ["oklch"],
	name: "Linear RGB to OKLch",
	aliases: ["sRGB to OKLch", "RGB to OKLch", ...CONVERSION, "Perceptual Color"],
	category: "color",
	build: (g) => {
		const rgb = g.input("rgb", "vec3f", { label: "Linear RGB" });
		const { oklab } = g.call(linearRgbToOklab, { rgb });
		g.output("oklch", g.call(oklabToOklch, { oklab }).oklch, "vec3f", {
			label: "OKLch",
		});
	},
});

const oklchToLinearRgb = group({
	id: "std-oklch-to-linear-rgb",
	inputs: ["oklch"],
	outputs: ["rgb"],
	name: "OKLch to Linear RGB",
	aliases: ["OKLch to sRGB", "OKLch to RGB", ...CONVERSION, "Perceptual Color"],
	category: "color",
	build: (g) => {
		const oklch = g.input("oklch", "vec3f", { label: "OKLch" });
		const { oklab } = g.call(oklchToOklab, { oklch });
		g.output("rgb", g.call(oklabToLinearRgb, { oklab }).rgb, "vec3f", {
			label: "Linear RGB",
		});
	},
});

const inDisplayGamut = group({
	id: "std-in-display-gamut",
	inputs: ["rgb"],
	outputs: ["in-gamut"],
	name: "In Display Gamut",
	aliases: ["Gamut Check", "Out of Gamut", "In sRGB Gamut", "In Display P3 Gamut", ...CONVERSION],
	category: "color",
	build: (g) => {
		const rgb = g.input("rgb", "vec3f", { label: "Linear RGB" });
		const moved = g.distance(rgb, g.displayGamutClip(rgb));
		g.output("in-gamut", g.compare(moved, 0.00001, { op: "<=" }), "bool", {
			label: "In Gamut",
		});
	},
});

/** How far apart (in OKLab) a colour and its clipped self may be for the clip to pass. */
const JUST_NOTICEABLE = 0.02;

const oklchGamutMap = group({
	id: "std-oklch-gamut-map",
	inputs: ["oklch"],
	outputs: ["rgb"],
	name: "OKLch Gamut Map",
	aliases: [
		"Gamut Mapping",
		"Gamut Clip",
		"OKLch to sRGB",
		"OKLch to Display P3",
		"Fit in Gamut",
		...CONVERSION,
	],
	category: "color",
	build: (g) => {
		const oklch = g.input("oklch", "vec3f", { label: "OKLch" });
		const { x: lightness, y: chroma, z: hue } = g.separateVector(oklch);
		const toRgb = (lch: Ref) => {
			const { oklab } = g.call(oklchToOklab, { oklch: lch });
			return { oklab, rgb: g.call(oklabToLinearRgb, { oklab }).rgb };
		};
		/** Whether clipping `rgb` to the display keeps it within notice of `oklab`. */
		const clipsUnnoticed = (oklab: Ref, rgb: Ref) => {
			const clipped = g.displayGamutClip(rgb);
			const back = g.call(linearRgbToOklab, { rgb: clipped }).oklab;
			return {
				clipped,
				close: g.compare(g.distance(back, oklab), JUST_NOTICEABLE, { op: "<" }),
			};
		};

		const direct = g.frame(
			"Clipped",
			{ note: "The colour clipped to the display, if that's barely noticeable." },
			() => {
				const { oklab, rgb } = toRgb(oklch);
				return clipsUnnoticed(oklab, rgb);
			},
		);

		const search = g.frame(
			"Chroma search",
			{
				note: "Otherwise, the most chroma at that lightness and hue that the display\nshows, or nearly: halving the range 16 times (CSS Color 4's algorithm).",
			},
			() =>
				g.repeat(
					16,
					{
						Low: ["f32", 0],
						High: ["f32", chroma],
						"Low In Gamut": ["bool", true],
					},
					(_, s) => {
						const middle = g.mul(g.add(s.Low, s.High), 0.5);
						const { oklab, rgb } = toRgb(g.vec("vec3f", lightness, middle, hue));
						const inGamut = g.call(inDisplayGamut, { rgb })["in-gamut"];
						const { close } = clipsUnnoticed(oklab, rgb);
						const raise = g.booleanMath(
							g.booleanMath(s["Low In Gamut"], inGamut, { op: "and" }),
							close,
							{ op: "or" },
						);
						return {
							Low: g.switch(raise, s.Low, middle),
							High: g.switch(raise, middle, s.High),
							"Low In Gamut": g.booleanMath(
								s["Low In Gamut"],
								g.booleanMath(inGamut, g.not(close), { op: "or" }),
								{ op: "and" },
							),
						};
					},
				),
		);

		const mapped = g.frame("Mapped", { note: "The colour at the chroma found, clipped." }, () =>
			g.displayGamutClip(toRgb(g.vec("vec3f", lightness, search.Low, hue)).rgb),
		);

		g.frame("Extremes", { note: "White past full lightness, black at none." }, () => {
			const fitted = g.switch(direct.close, mapped, direct.clipped);
			const white = g.switch(
				g.compare(lightness, 1, { op: ">=" }),
				fitted,
				g.constant("vec3f", 1),
			);
			const color = g.switch(
				g.compare(lightness, 0, { op: "<=" }),
				white,
				g.constant("vec3f", 0),
			);
			g.output("rgb", color, "vec3f", { label: "Linear RGB" });
		});
	},
});

const MODES = [
	[0, "RGB"],
	[1, "HSV"],
	[2, "OKLch"],
] as const;

const color = group({
	id: "std-color",
	inputs: [
		"mode",
		"red",
		"green",
		"blue",
		"hue",
		"saturation",
		"value",
		"lightness",
		"chroma",
		"oklch-hue",
		"alpha",
	],
	outputs: ["color", "rgba"],
	name: "Color",
	aliases: [
		"RGB",
		"RGBA",
		"Combine Color",
		"Combine RGB",
		"Combine HSV",
		"Color Constant",
		"Solid Color",
		"OKLch",
	],
	category: "color",
	build: (g) => {
		const mode = g.enum("mode", MODES, 1, { label: "Mode" });
		const owned = (value: number) => ({ owner: { enum: mode, value } });
		const unit = { min: 0, max: 1 };

		const rgb = g.frame("RGB", { note: "Red, green and blue, as given." }, () =>
			g.vec(
				"vec3f",
				g.input("red", "f32", { label: "Red", default: 0.8, ...owned(0) }),
				g.input("green", "f32", { label: "Green", default: 0.8, ...owned(0) }),
				g.input("blue", "f32", { label: "Blue", default: 0.8, ...owned(0) }),
			),
		);

		const hsv = g.frame("HSV", {}, () => {
			const {
				x: h,
				y: s,
				z: v,
			} = g.separateVector(
				g.vec(
					"vec3f",
					g.input("hue", "f32", { label: "Hue", default: 0, ...unit, ...owned(1) }),
					g.input("saturation", "f32", {
						label: "Saturation",
						default: 0,
						...unit,
						...owned(1),
					}),
					g.input("value", "f32", {
						label: "Value",
						default: 0.9063,
						...unit,
						...owned(1),
					}),
				),
			);
			const srgb = g.frame(
				"To sRGB",
				{
					note: "Each channel's distance around the hue circle,\nmixed in by saturation and scaled by value.",
				},
				() => {
					const offset = g.fract(
						g.add(h, g.constant("vec3f", { x: 1, y: 2 / 3, z: 1 / 3 })),
					);
					const ramp = g.clamp(g.sub(g.abs(g.sub(g.mul(offset, 6), 3)), 1), 0, 1);
					return g.max(g.mul(g.mix(1, ramp, s), v), 0);
				},
			);
			return g.frame(
				"To linear",
				{ note: "sRGB's transfer function undone: HSV picks display colours." },
				() =>
					g.switch(
						g.compare(srgb, 0.04045, { op: "<=" }),
						g.pow(g.div(g.add(srgb, 0.055), 1.055), 2.4),
						g.div(srgb, 12.92),
					),
			);
		});

		const oklch = g.frame(
			"OKLch",
			{ note: "Lightness, chroma and hue (in degrees), mapped into the display's gamut." },
			() => {
				const lch = g.vec(
					"vec3f",
					g.input("lightness", "f32", {
						label: "Lightness",
						default: 0.9283,
						...unit,
						...owned(2),
					}),
					g.input("chroma", "f32", { label: "Chroma", default: 0, ...unit, ...owned(2) }),
					g.input("oklch-hue", "f32", {
						label: "Hue",
						default: 0,
						min: 0,
						max: 360,
						...owned(2),
					}),
				);
				return g.call(oklchGamutMap, { oklch: lch }).rgb;
			},
		);

		const chosen = g.match(mode, { 0: rgb, 1: hsv, 2: oklch });
		g.output("color", chosen, "vec3f", { label: "Color" });
		g.frame("Alpha", {}, () => {
			const { x, y, z } = g.separateVector(chosen);
			const alpha = g.input("alpha", "f32", { label: "Alpha", default: 1, ...unit });
			g.output("rgba", g.vec("vec4f", x, y, z, alpha), "vec4f", { label: "RGBA" });
		});
	},
	widget: (input) => ({
		kind: "color",
		mode: input("mode"),
		modes: {
			0: { space: "rgb", components: [input("red"), input("green"), input("blue")] },
			1: { space: "hsv", components: [input("hue"), input("saturation"), input("value")] },
			2: {
				space: "oklch",
				components: [input("lightness"), input("chroma"), input("oklch-hue")],
			},
		},
	}),
});

export default [
	linearRgbToXyz,
	xyzToLinearRgb,
	xyzToOklab,
	oklabToXyz,
	linearRgbToOklab,
	oklabToLinearRgb,
	oklabToOklch,
	oklchToOklab,
	linearRgbToOklch,
	oklchToLinearRgb,
	inDisplayGamut,
	oklchGamutMap,
	color,
];
