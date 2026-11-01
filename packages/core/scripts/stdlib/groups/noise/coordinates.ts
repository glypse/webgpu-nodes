// Noise coordinates: their type decides a noise's dimensions, one per
// component, and every helper working on them is generic over it.
import {
	type GroupBuilder,
	type GroupSpec,
	helpers,
	type Ref,
	type VariableType,
} from "../../builder";

/**
 * The types noise coordinates take, one per dimension count: 2D first, the
 * type they have when nothing decides it (unlinked, they're the UV).
 */
const COORDINATE_TYPES = ["vec2f", "vec3f", "vec4f", "f32"] as const;

/** A group's coordinates type: its sockets taking it follow the noise's dimensions. */
export function coordinatesType(g: GroupBuilder): VariableType {
	return g.typeVariable("t", "T", COORDINATE_TYPES);
}

export type CoordinatesInput = { t: VariableType; vector: Ref };

/**
 * A noise's coordinates input, keyed as `std-noise-coordinates` takes it so
 * it can be passed on, and its type.
 */
export function coordinatesInput(g: GroupBuilder): CoordinatesInput {
	const t = coordinatesType(g);
	return { t, vector: g.input("vector", t, { label: "Vector" }) };
}

export const noiseCoordinates: GroupSpec = {
	id: "std-noise-coordinates",
	name: "Noise Coordinates",
	aliases: ["Texture Coordinates", "Noise Vector"],
	category: "texture",
	...helpers(),
	build: (g) => {
		const { t, vector } = coordinatesInput(g);
		g.output("coordinates", g.fallback(vector, g.uv()), t, { label: "Coordinates" });
	},
};
