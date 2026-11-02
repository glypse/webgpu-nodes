// OpenSimplex2 (K.jpg, CC0) in each dimension count: which lattice points
// are close enough to a position to count, found without branching, and
// their kernels summed. 1D is plain gradient noise. Each output is scaled
// to [-1, 1], measured on these gradients.
import { group, type GroupBuilder, type Operand, type Ref } from "../../../builder";
import { copySeed, kernel, SIMPLEX_HELPERS } from "./kernel";
import { FAST, SMOOTH, variantInput } from "./orientation";

/** 1 / the largest value each one reaches. */
const NORMALIZERS = {
	1: 3.206,
	2: { [FAST]: 99.28, [SMOOTH]: 18.16 },
	3: { [FAST]: 32.84, [SMOOTH]: 3.618 },
	4: { [FAST]: 108.7, [SMOOTH]: 8.724 },
};

/** How far from a point its kernel reaches, squared: exact for the points each looks at. */
const RADII = {
	2: { [FAST]: 0.5, [SMOOTH]: 2 / 3 },
	3: { [FAST]: 0.5, [SMOOTH]: 0.75 },
	4: { [FAST]: 0.5, [SMOOTH]: 0.8 },
};

const UNSKEW_2D = -0.21132486540518713;
const UNSKEW_4D = { [FAST]: 0.309016994374947, [SMOOTH]: -0.138196601125011 };

function seedInput(g: GroupBuilder): Ref {
	return g.input("seed", "i32", { label: "Seed", default: 0 });
}

/** A skewed lattice's offset `q` back in real space: q + (q · 1) × unskew. */
function unskew(g: GroupBuilder, q: Ref, factor: number): Ref {
	return g.add(q, g.mul(g.dot(q, 1), factor));
}

export const gradientNoise1d = group({
	id: "std-gradient-noise-1d",
	inputs: ["value", "seed"],
	outputs: ["value"],
	name: "Gradient Noise 1D",
	aliases: ["1D Noise", "Perlin 1D", "Simplex 1D", "Line Noise"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const x = g.input("value", "f32", { label: "Value" });
		const seed = seedInput(g);
		g.frame(
			"Neighbors",
			{
				note: "The kernels of the whole numbers on either side, reaching 1:\nonly those two are ever close enough.",
			},
			() => {
				const left = g.floor(x);
				const right = g.add(left, 1);
				const sum = g.add(
					kernel(g, left, g.sub(x, left), 1, seed),
					kernel(g, right, g.sub(x, right), 1, seed),
				);
				g.output("value", g.mul(sum, NORMALIZERS[1]), "f32", { label: "Value" });
			},
		);
	},
});

export const openSimplex2d = group({
	id: "std-opensimplex-2d",
	inputs: ["lattice", "variant", "seed"],
	outputs: ["value"],
	name: "OpenSimplex 2D",
	aliases: ["Simplex 2D", "OpenSimplex2 2D", "SuperSimplex 2D"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const position = g.input("lattice", "vec2f", { label: "Lattice Position" });
		const variant = variantInput(g);
		const seed = seedInput(g);
		const { base, local } = g.frame(
			"Cell",
			{ note: "The skewed square the position is in, and where in it." },
			() => {
				const base = g.floor(position);
				return {
					base: g.wireless("Cell", base),
					local: g.wireless("Local", g.sub(position, base)),
				};
			},
		);
		const at = (x: number, y: number) => g.constant("vec2f", { x, y });
		const vertexSum = (offsets: Operand[], radius: number) =>
			g.add(
				...offsets.map((offset) => {
					const vertex = g.add(base, offset);
					return kernel(
						g,
						vertex,
						unskew(g, g.sub(position, vertex), UNSKEW_2D),
						radius,
						seed,
					);
				}),
			);
		const { x, y } = g.separateVector(local);
		const fast = g.frame(
			"Fast",
			{
				note: "The 3 corners of the triangle the position is in: the square's\ntwo ends of its diagonal, and the corner on the position's side.",
			},
			() => {
				const third = g.switch(g.compare(y, x, { op: ">" }), at(1, 0), at(0, 1));
				const sum = vertexSum([at(0, 0), at(1, 1), third], RADII[2][FAST]);
				return g.mul(sum, NORMALIZERS[2][FAST]);
			},
		);
		const smooth = g.frame(
			"Smooth",
			{
				note: "The square's diagonal ends, and the 2 points across the triangle's\nother edges that its larger kernels reach, past the square when\nthe position is near a corner.",
			},
			() => {
				const far = g.compare(g.add(x, y), 1, { op: ">" });
				const xmy = g.sub(x, y);
				const third = g.switch(
					far,
					g.switch(g.compare(g.add(x, xmy), 0, { op: "<" }), at(1, 0), at(-1, 0)),
					g.switch(g.compare(g.add(x, xmy), 1, { op: ">" }), at(0, 1), at(2, 1)),
				);
				const fourth = g.switch(
					far,
					g.switch(g.compare(y, xmy, { op: "<" }), at(0, 1), at(0, -1)),
					g.switch(g.compare(g.sub(y, xmy), 1, { op: ">" }), at(1, 0), at(1, 2)),
				);
				const sum = vertexSum([at(0, 0), at(1, 1), third, fourth], RADII[2][SMOOTH]);
				return g.mul(sum, NORMALIZERS[2][SMOOTH]);
			},
		);
		g.output("value", g.match(variant, { [FAST]: fast, [SMOOTH]: smooth }), "f32", {
			label: "Value",
		});
	},
});

export const bccHalfLattice = group({
	id: "std-opensimplex-3d-half",
	inputs: ["lattice", "variant", "seed"],
	outputs: ["value"],
	name: "OpenSimplex 3D Half-Lattice",
	aliases: ["BCC Half-Lattice", "Cubic Lattice Half"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const position = g.input("lattice", "vec3f", { label: "Lattice Position" });
		const variant = variantInput(g);
		const seed = seedInput(g);
		const v3 = (x: number, y: number, z: number) => g.constant("vec3f", { x, y, z });
		const fast = g.frame(
			"Fast",
			{
				note: "The closest whole point, and the next one along the axis\nthe position is furthest along from it.",
			},
			() => {
				const closest = g.node("round", { e: position });
				const offset = g.sub(position, closest);
				const distance = g.abs(offset);
				const { x, y, z } = g.separateVector(distance);
				const others = g.vec("vec3f", g.max(y, z), g.max(z, x), g.max(x, y));
				const along = g.step(others, distance);
				const next = g.add(closest, g.mul(along, g.sign(offset)));
				const radius = RADII[3][FAST];
				return g.add(
					kernel(g, closest, offset, radius, seed),
					kernel(g, next, g.sub(position, next), radius, seed),
				);
			},
		);
		const smooth = g.frame(
			"Smooth",
			{
				note: "Of each pair of opposite corners of the unit cube around the position,\nthe one on its side of the plane between them.",
			},
			() => {
				const base = g.floor(position);
				const local = g.sub(position, base);
				const corner = (
					normal: [number, number, number],
					bias: number,
					from: [number, number, number],
					toward: [number, number, number],
				) => {
					const far = g.floor(g.add(g.dot(local, v3(...normal)), bias));
					return g.add(base, v3(...from), g.mul(v3(...toward), far));
				};
				const corners = [
					corner([0.25, 0.25, 0.25], 0.625, [0, 0, 0], [1, 1, 1]),
					corner([-0.25, 0.25, 0.25], 0.875, [1, 0, 0], [-1, 1, 1]),
					corner([0.25, -0.25, 0.25], 0.875, [0, 1, 0], [1, -1, 1]),
					corner([0.25, 0.25, -0.25], 0.875, [0, 0, 1], [1, 1, -1]),
				];
				return g.add(
					...corners.map((c) => kernel(g, c, g.sub(position, c), RADII[3][SMOOTH], seed)),
				);
			},
		);
		g.output("value", g.match(variant, { [FAST]: fast, [SMOOTH]: smooth }), "f32", {
			label: "Value",
		});
	},
});

export const openSimplex3d = group({
	id: "std-opensimplex-3d",
	inputs: ["lattice", "variant", "seed"],
	outputs: ["value"],
	name: "OpenSimplex 3D",
	aliases: ["Simplex 3D", "OpenSimplex2 3D", "SuperSimplex 3D", "BCC Noise"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const position = g.input("lattice", "vec3f", { label: "Lattice Position" });
		const variant = variantInput(g);
		const seed = seedInput(g);
		g.frame(
			"Lattices",
			{
				note: "A body-centred cubic lattice: whole points, and a copy offset by ½\nwith gradients of its own.",
			},
			() => {
				const half = (lattice: Ref, copy: number) =>
					g.call(bccHalfLattice, {
						lattice,
						variant,
						seed: copySeed(g, seed, copy),
					}).value;
				const sum = g.add(half(position, 0), half(g.add(position, 0.5), 1));
				const normalizer = g.match(variant, {
					[FAST]: NORMALIZERS[3][FAST],
					[SMOOTH]: NORMALIZERS[3][SMOOTH],
				});
				g.output("value", g.mul(sum, normalizer), "f32", { label: "Value" });
			},
		);
	},
});

/**
 * The canonical vertices Smooth 4D looks at, for a position whose cell
 * coordinates are sorted (x ≥ y ≥ z ≥ w) and add up to at most 2: every
 * lattice point within its kernel's reach of such a position.
 */
const SORTED_VERTICES: [number, number, number, number][] = [
	[0, -1, -1, -1],
	[0, -1, 0, 0],
	[0, 0, -1, -1],
	[0, 0, -1, 0],
	[0, 0, 0, -1],
	[0, 0, 0, 0],
	[0, 0, 0, 1],
	[0, 0, 1, 0],
	[0, 1, 0, 0],
	[0, 1, 1, 0],
	[1, 0, -1, 0],
	[1, 0, 0, -1],
	[1, 0, 0, 0],
	[1, 0, 0, 1],
	[1, 0, 1, 0],
	[1, 0, 1, 1],
	[1, 1, 0, 0],
	[1, 1, 0, 1],
	[1, 1, 1, 0],
	[1, 1, 1, 1],
	[2, 1, 0, 0],
	[2, 1, 1, 0],
	[2, 1, 1, 1],
];

const AXES = ["x", "y", "z", "w"] as const;

export const openSimplex4d = group({
	id: "std-opensimplex-4d",
	inputs: ["lattice", "variant", "seed"],
	outputs: ["value"],
	name: "OpenSimplex 4D",
	aliases: ["Simplex 4D", "OpenSimplex2 4D", "SuperSimplex 4D"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const position = g.input("lattice", "vec4f", { label: "Lattice Position" });
		const variant = variantInput(g);
		const seed = seedInput(g);
		const int = (n: number) => g.constant("i32", n);
		const v4 = (x: number, y: number, z: number, w: number) =>
			g.constant("vec4f", { x, y, z, w });
		const base = g.wireless("Cell", g.floor(position));

		const fast = g.frame(
			"Fast",
			{
				note: "Five copies of the A4 lattice, each ⅕ further along the diagonal,\none point of each: the closest corner of the simplex the position\nis in, moving one axis further per copy.",
			},
			() => {
				const u = UNSKEW_4D[FAST];
				const { start, local, diagonal } = g.frame(
					"First copy",
					{
						note: "The copy sure to have a point in the cell's base simplex,\nfrom how far along the diagonal the position is.",
					},
					() => {
						const cell = g.sub(position, base);
						const sum = g.dot(cell, 1);
						const start = g.toInt(g.floor(g.mul(sum, 1.25)));
						const shift = g.mul(g.toFloat(start), -0.2);
						return {
							start: g.wireless("First Copy", start),
							local: g.add(cell, shift),
							diagonal: g.mul(g.add(sum, g.mul(shift, 4)), u),
						};
					},
				);
				const copies = g.repeat(
					int(5),
					{
						Local: ["vec4f", local],
						Diagonal: ["f32", diagonal],
						Vertex: ["vec4f", base],
						Value: ["f32", 0],
					},
					(iteration, s) => {
						const { moved, lead } = g.frame(
							"Step",
							{
								note: "The axis the position is furthest along (the first on a tie),\nstepped once it's past the simplex's far face.",
							},
							() => {
								const { x, y, z, w } = g.separateVector(s.Local);
								const lead = g.max(x, y, z, w);
								const isLead = g.step(lead, s.Local);
								const e = g.separateVector(isLead);
								const before = g.vec(
									"vec4f",
									0,
									e.x,
									g.add(e.x, e.y),
									g.add(e.x, e.y, e.z),
								);
								const first = g.mul(isLead, g.sub(1, g.min(before, 1)));
								const face = g.sub(1, g.div(s.Diagonal, u));
								const moves = g.switch(g.compare(lead, face, { op: ">=" }), 0, 1);
								return { moved: g.mul(first, moves), lead: moves };
							},
						);
						const local = g.sub(s.Local, moved);
						const diagonal = g.sub(s.Diagonal, g.mul(lead, u));
						const vertex = g.add(s.Vertex, moved);
						const copy = g.mod(g.add(g.sub(start, iteration), int(5)), int(5));
						const value = kernel(
							g,
							vertex,
							g.add(local, diagonal),
							RADII[4][FAST],
							copySeed(g, seed, copy),
						);
						return g.frame(
							"Next copy",
							{
								note: "⅕ further along the diagonal; past the first copy the\ncell's corner falls one step back.",
							},
							() => ({
								Local: g.add(local, 0.2),
								Diagonal: g.add(diagonal, 0.8 * u),
								Vertex: g.sub(
									vertex,
									g.switch(g.compare(iteration, start, { op: "==" }), 0, 1),
								),
								Value: g.add(s.Value, value),
							}),
						);
					},
				);
				return g.mul(copies.Value, NORMALIZERS[4][FAST]);
			},
		);

		const smooth = g.frame(
			"Smooth",
			{
				note: "The A4* lattice's points within reach, from a table of those around\na cell whose coordinates are sorted, the position's sorted the same way.",
			},
			() => {
				const { flipped, cell } = g.frame(
					"Symmetry",
					{
						note: "Past the cell's middle diagonal, mirrored through its centre,\nso the coordinates add up to at most 2.",
					},
					() => {
						const cell = g.sub(position, base);
						const flipped = g.wireless(
							"Flipped",
							g.compare(g.dot(cell, 1), 2, { op: ">" }),
						);
						return { flipped, cell: g.switch(flipped, cell, g.sub(1, cell)) };
					},
				);
				const picks = g.frame(
					"Ranks",
					{
						note: "Each axis's rank among the coordinates, largest first (the first\naxis on a tie), and which axis has each rank.",
					},
					() => {
						const q = g.separateVector(cell);
						const rank = g.add(
							...AXES.map((axis, j) => {
								const after = v4(
									...(AXES.map((_, i) => Number(i > j)) as [
										number,
										number,
										number,
										number,
									]),
								);
								const before = v4(
									...(AXES.map((_, i) => Number(i < j)) as [
										number,
										number,
										number,
										number,
									]),
								);
								const atLeast = g.toFloat(g.compare(q[axis], cell, { op: ">=" }));
								const above = g.toFloat(g.compare(q[axis], cell, { op: ">" }));
								return g.add(g.mul(atLeast, after), g.mul(above, before));
							}),
						);
						return AXES.map((_, r) => g.sub(1, g.min(g.abs(g.sub(rank, r)), 1)));
					},
				);
				const sum = g.repeat(
					int(SORTED_VERTICES.length),
					{ Value: ["f32", 0] },
					(iteration, s) => {
						const sorted = g.indexSwitch(
							iteration,
							SORTED_VERTICES.map(([x, y, z, w]) => ({ x, y, z, w })),
							"vec4f",
						);
						const c = g.separateVector(sorted);
						const offset = g.add(
							...AXES.map((axis, r) => g.mul(c[axis], picks[r] ?? 0)),
						);
						const vertex = g.add(base, g.switch(flipped, offset, g.sub(1, offset)));
						const value = kernel(
							g,
							vertex,
							unskew(g, g.sub(position, vertex), UNSKEW_4D[SMOOTH]),
							RADII[4][SMOOTH],
							seed,
						);
						return { Value: g.add(s.Value, value) };
					},
				).Value;
				return g.mul(sum, NORMALIZERS[4][SMOOTH]);
			},
		);
		g.output("value", g.match(variant, { [FAST]: fast, [SMOOTH]: smooth }), "f32", {
			label: "Value",
		});
	},
});
