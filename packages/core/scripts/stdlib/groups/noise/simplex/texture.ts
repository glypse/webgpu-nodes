// OpenSimplex Noise in any dimension count, and Fractal Noise: its octaves
// summed in Blender's fractal types (cycles/kernel/svm/fractal_noise.h).
import {
	type EnumRef,
	group,
	type GroupBuilder,
	type Operand,
	type Ref,
	type VariableType,
} from "../../../builder";
import { padVector } from "../../vector";
import { coordinatesInput, coordinatesType, noiseCoordinates } from "../coordinates";
import { fractal, fractalInputs } from "../fractal";
import { hash } from "../lattice";
import { SIMPLEX_HELPERS } from "./kernel";
import { gradientNoise1d, openSimplex2d, openSimplex3d, openSimplex4d } from "./lattices";
import {
	type OrientationInputs,
	orientationInputs,
	simplexOrientation,
	variantInput,
} from "./orientation";

/** XORed into the seed for Color's second and third components. */
const COLOR_SALTS = [1540483477, 668265263] as const;
/** XORed into the seed for each axis of the distortion. */
const DISTORTION_SALT = 1103515245;
/** How far apart, at most, the octaves are moved, in their own scale. */
const OCTAVE_SPREAD = 128;

type NoiseOptions = OrientationInputs & { variant: EnumRef; seed: Operand };

/** The noise's options, on a group whose coordinates are `t`. */
function noiseOptions(g: GroupBuilder, t: VariableType): NoiseOptions {
	return {
		variant: variantInput(g, t),
		...orientationInputs(g, t),
		seed: g.input("seed", "i32", { label: "Seed", default: 0 }),
	};
}

export const openSimplexNoise = group({
	id: "std-opensimplex-noise",
	inputs: ["vector", "variant", "orientation2d", "orientation3d", "orientation4d", "seed"],
	outputs: ["value"],
	name: "OpenSimplex Noise",
	aliases: ["Simplex Noise", "OpenSimplex2", "SuperSimplex", "Gradient Noise", "Perlin"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const { t, vector } = coordinatesInput(g);
		const { variant, seed, ...orientations } = noiseOptions(g, t);
		const { coordinates } = g.call(noiseCoordinates, { vector });
		const { lattice } = g.call(simplexOrientation, {
			vector: coordinates,
			variant,
			...orientations,
		});
		const options = { lattice, variant, seed };
		const value = g.frame(
			"Lattices",
			{
				note: "OpenSimplex2 in as many dimensions as Vector has components,\nplain gradient noise for a single one. In [-1, 1].",
			},
			() =>
				g.match(
					g.componentCount(coordinates),
					{
						1: g.call(gradientNoise1d, { value: coordinates, seed }).value,
						2: g.call(openSimplex2d, options).value,
						3: g.call(openSimplex3d, options).value,
						4: g.call(openSimplex4d, options).value,
					},
					"f32",
				),
		);
		g.output("value", value, "f32", { label: "Value" });
	},
});

const noise = (g: GroupBuilder, vector: Operand, options: NoiseOptions) =>
	g.call(openSimplexNoise, { vector, ...options }).value;

export const noiseDistortion = group({
	id: "std-noise-distortion",
	inputs: [
		"vector",
		"amount",
		"variant",
		"orientation2d",
		"orientation3d",
		"orientation4d",
		"seed",
	],
	outputs: ["distorted"],
	name: "Noise Distortion",
	aliases: ["Domain Warp", "Warp", "Distort Coordinates"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const vector = g.input("vector", t, { label: "Vector" });
		const amount = g.input("amount", "f32", { label: "Amount", default: 0 });
		const options = noiseOptions(g, t);
		const { padded } = g.call(padVector, { vector });
		const distorted = g.repeat(
			g.switch(
				g.compare(amount, 0, { op: "!=" }),
				g.constant("i32", 0),
				g.constant("i32", 1),
			),
			{ Distorted: ["vec4f", padded] },
			() =>
				g.frame(
					"Distortion",
					{
						note: "Moved by a noise of its own along each axis, times Amount: run once,\nor not at all without distortion, so its noises cost nothing then.",
					},
					() => {
						const axis = (i: number) =>
							noise(g, vector, {
								...options,
								seed: g.bitwise(
									options.seed,
									g.constant("i32", (DISTORTION_SALT * (i + 1)) | 0),
									{ op: "^" },
								),
							});
						const [x, y, z, w] = [0, 1, 2, 3].map(axis);
						const offset = g.match(
							g.componentCount(vector),
							{
								1: g.vec("vec4f", x ?? 0, 0, 0, 0),
								2: g.vec("vec4f", x ?? 0, y ?? 0, 0, 0),
								3: g.vec("vec4f", x ?? 0, y ?? 0, z ?? 0, 0),
								4: g.vec("vec4f", x ?? 0, y ?? 0, z ?? 0, w ?? 0),
							},
							"vec4f",
						);
						return { Distorted: g.add(padded, g.mul(offset, amount)) };
					},
				),
		);
		g.output("distorted", distorted.Distorted, t, { label: "Distorted" });
	},
});

export const octaveShift = group({
	id: "std-octave-shift",
	inputs: ["vector", "octave", "seed"],
	outputs: ["shifted"],
	name: "Octave Shift",
	aliases: ["Octave Offset", "Decorrelate Octaves"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const vector = g.input("vector", t, { label: "Vector" });
		const octave = g.input("octave", "i32", { label: "Octave", default: 0 });
		const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
		g.frame(
			"Shift",
			{
				note: "Moved by a random amount per octave, so the octaves' lattices\ndon't line up at the origin, nor along their axes.",
			},
			() => {
				const { hash: random } = g.call(hash, { value: octave, seed });
				g.output("shifted", g.add(vector, g.mul(random, OCTAVE_SPREAD)), t, {
					label: "Shifted",
				});
			},
		);
	},
});

const TYPES = [
	[0, "fBm"],
	[1, "Multifractal"],
	[2, "Hybrid Multifractal"],
	[3, "Heterogeneous Terrain"],
	[4, "Ridged Multifractal"],
] as const;
const FBM = 0;
const MULTIFRACTAL = 1;
const HYBRID = 2;
const HETERO = 3;
const RIDGED = 4;

/**
 * Fractal Noise's inputs, keyed as `std-fractal-noise-octaves` takes them.
 * Each type has an Offset and Gain of its own, where it uses them: Blender's
 * shared defaults (0 and 1) leave Hybrid and Heterogeneous weighting their
 * octaves by the noise itself, and Ridged at the square of it, near black.
 */
function octaveInputs(g: GroupBuilder) {
	const type = g.enum("type", TYPES, FBM, { label: "Type" });
	const octaves = fractalInputs(g);
	const normalize = g.input("normalize", "bool", {
		label: "Normalize",
		default: true,
		owner: { enum: type, value: FBM },
	});
	const owned = (key: string, label: string, value: number, owner: number) =>
		g.input(key, "f32", { label, default: value, owner: { enum: type, value: owner } });
	return {
		type,
		...octaves,
		normalize,
		hybridOffset: owned("hybridOffset", "Offset", 0.5, HYBRID),
		hybridGain: owned("hybridGain", "Gain", 1, HYBRID),
		heteroOffset: owned("heteroOffset", "Offset", 0.5, HETERO),
		ridgedOffset: owned("ridgedOffset", "Offset", 1, RIDGED),
		ridgedGain: owned("ridgedGain", "Gain", 2, RIDGED),
	};
}

export const fractalNoiseOctaves = group({
	id: "std-fractal-noise-octaves",
	inputs: [
		"coordinates",
		"type",
		"detail",
		"roughness",
		"lacunarity",
		"normalize",
		"hybridOffset",
		"hybridGain",
		"heteroOffset",
		"ridgedOffset",
		"ridgedGain",
		"variant",
		"orientation2d",
		"orientation3d",
		"orientation4d",
		"seed",
	],
	outputs: ["value"],
	name: "Fractal Noise Octaves",
	aliases: ["fBm Octaves", "Fractal Sum", "Multifractal"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const coordinates = g.input("coordinates", t, { label: "Coordinates" });
		const {
			type,
			normalize,
			hybridOffset,
			hybridGain,
			heteroOffset,
			ridgedOffset,
			ridgedGain,
			...octaves
		} = octaveInputs(g);
		const options = noiseOptions(g, t);
		const pick = (cases: Record<number, Operand>) => g.match(type, cases);
		const sum = g.frame(
			"Octaves",
			{
				note: "OpenSimplex Noise again at each octave, its scale growing by\nLacunarity and its weight shrinking by Roughness, combined\nas the type does.",
			},
			() =>
				fractal(
					g,
					octaves,
					{
						Value: [
							"f32",
							pick({
								[FBM]: 0,
								[MULTIFRACTAL]: 1,
								[HYBRID]: 0,
								[HETERO]: 0,
								[RIDGED]: 0,
							}),
						],
						Weight: ["f32", 1],
						"Total Amplitude": ["f32", 0],
					},
					({ iteration, scale, amplitude, power }, s) => {
						const { shifted } = g.call(octaveShift, {
							vector: g.mul(coordinates, scale),
							octave: iteration,
							seed: options.seed,
						});
						const n = g.wireless("Octave", noise(g, shifted, options));
						const first = g.compare(iteration, g.constant("i32", 0), { op: "==" });
						const fbm = g.frame("fBm", { note: "The octaves' sum." }, () =>
							g.add(s.Value, g.mul(n, amplitude)),
						);
						const multifractal = g.frame(
							"Multifractal",
							{ note: "Their product: each scales what's there by 1 ± its weight." },
							() => g.mul(s.Value, g.add(g.mul(n, amplitude), 1)),
						);
						const hybrid = g.frame(
							"Hybrid Multifractal",
							{
								note: "Each octave weighted by the ones before (times Gain, at most 1),\nstopping once that weight is negligible.",
							},
							() => {
								const active = g.compare(s.Weight, 0.001, { op: ">" });
								const weight = g.min(s.Weight, 1);
								const raised = g.add(n, hybridOffset);
								const signal = g.mul(raised, power);
								return {
									value: g.switch(
										active,
										s.Value,
										g.add(s.Value, g.mul(weight, raised, amplitude)),
									),
									weight: g.switch(
										active,
										s.Weight,
										g.mul(weight, hybridGain, signal),
									),
								};
							},
						);
						const hetero = g.frame(
							"Heterogeneous Terrain",
							{
								note: "The first octave plus Offset, then each octave scaled by the\nheight so far: smooth lowlands, rough peaks.",
							},
							() => {
								const raised = g.add(n, heteroOffset);
								return g.switch(
									first,
									g.add(s.Value, g.mul(raised, amplitude, s.Value)),
									raised,
								);
							},
						);
						const ridged = g.frame(
							"Ridged Multifractal",
							{
								note: "Ridges where the noise crosses zero, (Offset − |noise|)², each octave\nweighted by the last one's ridge (times Gain, within [0, 1]).",
							},
							() => {
								const ridge = g.sub(ridgedOffset, g.abs(n));
								const squared = g.mul(ridge, ridge);
								const signal = g.mul(
									squared,
									g.clamp(g.mul(s.Weight, ridgedGain), 0, 1),
								);
								return {
									value: g.switch(
										first,
										g.add(s.Value, g.mul(signal, amplitude)),
										squared,
									),
									weight: g.switch(first, signal, squared),
								};
							},
						);
						return {
							Value: pick({
								[FBM]: fbm,
								[MULTIFRACTAL]: multifractal,
								[HYBRID]: hybrid.value,
								[HETERO]: hetero,
								[RIDGED]: ridged.value,
							}),
							Weight: pick({
								[FBM]: s.Weight,
								[MULTIFRACTAL]: s.Weight,
								[HYBRID]: hybrid.weight,
								[HETERO]: s.Weight,
								[RIDGED]: ridged.weight,
							}),
							"Total Amplitude": g.add(s["Total Amplitude"], amplitude),
						};
					},
				),
		);
		g.frame(
			"Normalize",
			{ note: "fBm's sum into [0, 1] by the weights' total, when normalized." },
			() => {
				const value = sum.Value;
				const normalized = g.add(g.mul(g.div(value, sum["Total Amplitude"]), 0.5), 0.5);
				const fbm = g.switch(normalize, value, normalized);
				g.output(
					"value",
					pick({
						[FBM]: fbm,
						[MULTIFRACTAL]: value,
						[HYBRID]: value,
						[HETERO]: value,
						[RIDGED]: value,
					}),
					"f32",
					{ label: "Value" },
				);
			},
		);
	},
});

export const fractalNoise = group({
	id: "std-fractal-noise",
	inputs: [
		"vector",
		"scale",
		"type",
		"detail",
		"roughness",
		"lacunarity",
		"normalize",
		"hybridOffset",
		"hybridGain",
		"heteroOffset",
		"ridgedOffset",
		"ridgedGain",
		"distortion",
		"variant",
		"orientation2d",
		"orientation3d",
		"orientation4d",
		"seed",
	],
	outputs: ["fac", "color"],
	name: "Fractal Noise",
	aliases: [
		"Noise Texture",
		"fBm",
		"FBM",
		"Multifractal",
		"Ridged Noise",
		"Simplex fBm",
		"Perlin Noise",
		"Clouds",
	],
	category: "texture",
	build: (g) => {
		const { t, vector } = coordinatesInput(g);
		const scale = g.input("scale", "f32", { label: "Scale", default: 5 });
		const octaves = octaveInputs(g);
		const distortion = g.input("distortion", "f32", { label: "Distortion", default: 0 });
		const options = noiseOptions(g, t);
		const distorted = g.frame(
			"Coordinates",
			{
				note: "Vector (the UV when unlinked) times Scale, moved by a noise\nof its own along each axis, times Distortion.",
			},
			() => {
				const { coordinates } = g.call(noiseCoordinates, { vector });
				const scaled = g.mul(coordinates, scale);
				const { distorted } = g.call(noiseDistortion, {
					vector: scaled,
					amount: distortion,
					...options,
				});
				return g.wireless("Coordinates", distorted);
			},
		);
		const sum = (seed: Operand): Ref =>
			g.call(fractalNoiseOctaves, {
				coordinates: distorted,
				...octaves,
				...options,
				seed,
			}).value;
		const fac = g.frame("Fac", { note: "The octaves, combined as Type does." }, () => {
			const fac = sum(options.seed);
			g.output("fac", fac, "f32", { label: "Fac" });
			return fac;
		});
		g.frame("Color", { note: "Fac and two more fractal noises, seeded apart." }, () => {
			const [green, blue] = COLOR_SALTS.map((salt) =>
				sum(g.bitwise(options.seed, g.constant("i32", salt), { op: "^" })),
			);
			g.output("color", g.vec("vec3f", fac, green ?? 0, blue ?? 0), "vec3f", {
				label: "Color",
			});
		});
	},
});
