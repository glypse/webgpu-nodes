// Conventions shared by noise textures: a Dimensions enum picking the inputs
// the coordinates come from, and fractal (fBm) octaves.
import type { WgslType } from "../../src/types";
import type { EnumRef, GroupBuilder, Operand, Ref } from "./builder";

export const DIMENSIONS = [
	[1, "1D"],
	[2, "2D"],
	[3, "3D"],
	[4, "4D"],
] as const;

export type DimensionInputs = {
	dimensions: EnumRef;
	w: Ref;
	vector2: Ref;
	vector3: Ref;
	vector4: Ref;
};

/**
 * A noise's Dimensions enum and the coordinates input of each dimension,
 * keyed as `std-noise-coordinates` takes them, so they can be passed on.
 */
export function dimensionInputs(g: GroupBuilder, initial = 2): DimensionInputs {
	const dimensions = g.enum("dimensions", DIMENSIONS, initial, { label: "Dimensions" });
	const owned = (value: number) => ({ owner: { enum: dimensions, value } });
	return {
		dimensions,
		w: g.input("w", "f32", { label: "W", ...owned(1) }),
		vector2: g.input("vector2", "vec2f", { label: "Vector", ...owned(2) }),
		vector3: g.input("vector3", "vec3f", { label: "Vector", ...owned(3) }),
		vector4: g.input("vector4", "vec4f", { label: "Vector", ...owned(4) }),
	};
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
