// Fractal noise (fBm): octaves of a noise, each finer and fainter, summed.
import {
	group,
	type GroupBuilder,
	helpers,
	type ItemType,
	type Operand,
	type Ref,
} from "../../builder";

/** The weight under which the octaves left of a fractal noise are dropped. */
const INAUDIBLE = 1 / 4096;

export type FractalInputs = { detail: Operand; roughness: Operand; lacunarity: Operand };

/** The fractal inputs of a noise, with Blender's ranges and defaults. */
export function fractalInputs(g: GroupBuilder): FractalInputs {
	return {
		detail: g.input("detail", "f32", { label: "Detail", default: 0, min: 0, max: 15 }),
		roughness: g.input("roughness", "f32", {
			label: "Roughness",
			default: 0.5,
			min: 0,
			max: 1,
		}),
		lacunarity: g.input("lacunarity", "f32", { label: "Lacunarity", default: 2, min: 0 }),
	};
}

export const fractalOctave = group({
	id: "std-fractal-octave",
	inputs: ["iteration", "detail", "roughness", "lacunarity"],
	outputs: ["scale", "amplitude", "power", "octaves"],
	name: "Fractal Octave",
	aliases: ["fBm Octave", "Octave", "Fractal Brownian Motion"],
	category: "texture",
	...helpers(),
	build: (g) => {
		const iteration = g.input("iteration", "i32", { label: "Octave", default: 0 });
		const detail = g.clamp(
			g.input("detail", "f32", { label: "Detail", default: 0, min: 0, max: 15 }),
			0,
			15,
		);
		const roughness = g.input("roughness", "f32", {
			label: "Roughness",
			default: 0.5,
			min: 0,
			max: 1,
		});
		const lacunarity = g.input("lacunarity", "f32", {
			label: "Lacunarity",
			default: 2,
			min: 0,
		});
		const octave = g.toFloat(iteration);
		g.frame(
			"Octave",
			{
				note: "Its scale and weight (Amplitude); the octave past Detail's\nwhole part counts for its fraction, which Power leaves out.",
			},
			() => {
				const weight = g.clamp(g.add(g.sub(detail, octave), 1), 0, 1);
				const power = g.pow(roughness, octave);
				g.output("scale", g.pow(lacunarity, octave), "f32", { label: "Scale" });
				g.output("amplitude", g.mul(power, weight), "f32", { label: "Amplitude" });
				g.output("power", power, "f32", { label: "Power" });
			},
		);
		g.frame(
			"Octaves",
			{
				note: "Detail's, stopping early once the weights of all the octaves left\n(at most Roughness^n / (1 - Roughness)) add up to under 1/4096.",
			},
			() => {
				const detailed = g.add(g.toInt(g.ceil(detail)), g.constant("i32", 1));
				const r = g.max(roughness, 0.000001);
				const needed = g.toInt(
					g.max(g.ceil(g.div(g.log(g.mul(g.sub(1, r), INAUDIBLE)), g.log(r))), 1),
				);
				const fading = g.compare(roughness, 1, { op: "<" });
				g.output("octaves", g.switch(fading, detailed, g.min(detailed, needed)), "i32", {
					label: "Octaves",
				});
			},
		);
	},
});

/** An octave as `fractal` hands it over: its index, and `std-fractal-octave`'s outputs. */
export type Octave = { iteration: Ref; scale: Ref; amplitude: Ref; power: Ref };

/**
 * Sum octaves of a noise (fBm): `octave` gets each octave's scale and
 * amplitude (the last one weighted by Detail's fraction) and the items'
 * current values, and returns their next ones, as `GroupBuilder.repeat`.
 */
export function fractal<K extends string>(
	g: GroupBuilder,
	inputs: FractalInputs,
	items: Record<K, readonly [ItemType, Operand]>,
	octave: (octave: Octave, state: Record<K, Ref>) => Record<K, Operand>,
): Record<K, Ref> {
	const { octaves } = g.call(fractalOctave, { ...inputs });
	return g.repeat(octaves, items, (iteration, state) => {
		const outputs = g.call(fractalOctave, {
			iteration,
			...inputs,
		});
		return octave({ iteration, ...outputs }, state);
	});
}
