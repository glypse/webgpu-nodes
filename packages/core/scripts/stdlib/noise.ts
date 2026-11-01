// Conventions shared by noise textures: coordinates whose type decides the
// noise's dimensions, and fractal (fBm) octaves.
import type { SocketType, WgslType } from "../../src/types";
import type { GroupBuilder, Operand, Ref } from "./builder";

export const DIMENSIONS = [
	[1, "1D"],
	[2, "2D"],
	[3, "3D"],
	[4, "4D"],
] as const;

/**
 * The types noise coordinates take, one per dimension count: 2D first, the
 * type they have when nothing decides it (unlinked, they're the UV).
 */
const COORDINATE_TYPES: readonly WgslType[] = ["vec2f", "vec3f", "vec4f", "f32"];

export type CoordinatesInput = { t: SocketType; vector: Ref };

/**
 * A noise's coordinates input, keyed as `std-noise-coordinates` takes it so
 * it can be passed on, and its type, which decides the noise's dimensions.
 */
export function coordinatesInput(g: GroupBuilder): CoordinatesInput {
	const t = g.typeVariable("t", "T", COORDINATE_TYPES);
	return { t, vector: g.input("vector", t, { label: "Vector" }) };
}

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

/**
 * Sum octaves of a noise (fBm): `octave` gets each octave's scale and
 * amplitude (the last one weighted by Detail's fraction) and the items'
 * current values, and returns their next ones, as `GroupBuilder.repeat`.
 */
export function fractal<K extends string>(
	g: GroupBuilder,
	inputs: FractalInputs,
	items: Record<K, readonly [WgslType, Operand]>,
	octave: (octave: { scale: Ref; amplitude: Ref }, state: Record<K, Ref>) => Record<K, Operand>,
): Record<K, Ref> {
	const { octaves } = g.call<"octaves">("std-fractal-octave", { ...inputs });
	return g.repeat(octaves, items, (iteration, state) =>
		octave(
			g.call<"scale" | "amplitude">("std-fractal-octave", { iteration, ...inputs }),
			state,
		),
	);
}
