// What every OpenSimplex lattice adds up: a random gradient per lattice
// point, faded out within a radius of it.
import { group, type GroupBuilder, helpers, type Operand, type Ref } from "../../../builder";
import { componentSum } from "../../vector";
import { coordinatesType } from "../coordinates";
import { hash } from "../lattice";

export const SIMPLEX_HELPERS = helpers("OpenSimplex");

/**
 * Added to the seed per copy of a lattice (times the copy's index), so the
 * copies get gradients of their own. Small enough for 4 × it to fit an i32.
 */
export const LATTICE_SALT = 461845907;

export const latticeGradient = group({
	id: "std-lattice-gradient",
	inputs: ["vertex", "seed"],
	outputs: ["gradient"],
	name: "Lattice Gradient",
	aliases: ["Random Gradient", "Gradient Vector", "Random Direction"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const vertex = g.input("vertex", t, { label: "Vertex" });
		const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
		const h = g.call(hash, { value: g.toInt(vertex), seed }).hash;
		const { x, y, z } = g.separateVector(h);
		const turn = (n: Ref) => g.mul(n, 2 * Math.PI);
		const line = g.frame("1D", { note: "A slope in [-1, 1]." }, () => g.sub(g.mul(x, 2), 1));
		const plane = g.frame("2D", { note: "A direction at a random angle." }, () =>
			g.vec("vec2f", g.cos(turn(x)), g.sin(turn(x))),
		);
		const space = g.frame(
			"3D",
			{
				note: "One of OpenSimplex2's 48 directions, an expanded rhombic dodecahedron's:\na cube corner, one of its 3 edges (zeroing an axis), and one of 2 points\non that face, all made the same length.",
			},
			() => {
				const k = g.min(g.floor(g.mul(x, 48)), 47);
				const cube = g.sub(
					g.mul(
						g.mod(g.floor(g.div(k, g.constant("vec3f", { x: 1, y: 2, z: 4 }))), 2),
						2,
					),
					1,
				);
				const axis = g.floor(g.div(k, 16));
				const kept = g.step(
					0.5,
					g.abs(g.sub(g.constant("vec3f", { x: 0, y: 1, z: 2 }), axis)),
				);
				const edge = g.mul(cube, kept);
				const face = g.mod(g.floor(g.div(k, 8)), 2);
				const rhomb = g.mix(
					cube,
					g.add(edge, g.node("cross", { e1: cube, e2: edge })),
					face,
				);
				return g.mul(
					g.add(g.mul(edge, 1.22474487139), rhomb),
					g.sub(1, g.mul(face, 0.042942436724648037)),
				);
			},
		);
		const hyper = g.frame(
			"4D",
			{
				note: "A direction spread evenly over the 4D sphere: two circles\nwhose radii share the length (r₁² + r₂² = 1) at random.",
			},
			() => {
				const r1 = g.sqrt(x);
				const r2 = g.sqrt(g.sub(1, x));
				return g.vec(
					"vec4f",
					g.mul(r1, g.cos(turn(y))),
					g.mul(r1, g.sin(turn(y))),
					g.mul(r2, g.cos(turn(z))),
					g.mul(r2, g.sin(turn(z))),
				);
			},
		);
		const gradient = g.widthSwitch(vertex, { 1: line, 2: plane, 3: space, 4: hyper });
		g.output("gradient", gradient, t, { label: "Gradient" });
	},
});

export const simplexKernel = group({
	id: "std-simplex-kernel",
	inputs: ["vertex", "offset", "radius", "seed"],
	outputs: ["value"],
	name: "Simplex Kernel",
	aliases: ["Surflet", "Gradient Kernel", "Simplex Contribution"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const vertex = g.input("vertex", t, { label: "Vertex" });
		const offset = g.input("offset", t, { label: "Offset" });
		const radius = g.input("radius", "f32", { label: "Radius²", default: 0.5 });
		const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
		const sum = (vector: Ref) => g.call(componentSum, { vector }).sum;
		const { gradient } = g.call(latticeGradient, { vertex, seed });
		g.frame(
			"Kernel",
			{
				note: "The vertex's gradient along the offset to it, faded by (r² − |offset|²)⁴:\nnothing past the radius, and smooth to its edge.",
			},
			() => {
				const falloff = g.max(g.sub(radius, sum(g.mul(offset, offset))), 0);
				const squared = g.mul(falloff, falloff);
				g.output("value", g.mul(squared, squared, sum(g.mul(gradient, offset))), "f32", {
					label: "Value",
				});
			},
		);
	},
});

/** A kernel's value at `offset` from the lattice point `vertex`. */
export function kernel(
	g: GroupBuilder,
	vertex: Operand,
	offset: Operand,
	radius: number,
	seed: Operand,
): Ref {
	return g.call(simplexKernel, { vertex, offset, radius, seed }).value;
}

/** `seed` for the lattice copy `copy`. */
export function copySeed(g: GroupBuilder, seed: Ref, copy: Ref | number): Ref {
	const salt =
		typeof copy === "number"
			? g.constant("i32", copy * LATTICE_SALT)
			: g.mul(copy, g.constant("i32", LATTICE_SALT));
	return g.add(seed, salt);
}
