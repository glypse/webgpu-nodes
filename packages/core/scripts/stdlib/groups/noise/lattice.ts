// Lattice noises cut space into unit cells: the cells around a point, and
// random values per cell.
import { type GroupSpec, helpers, type Ref } from "../../builder";
import { coordinatesType } from "./coordinates";

/** The integer types Hash takes, one per dimension count. */
const CELL_TYPES = ["vec4i", "vec3i", "vec2i", "i32"] as const;

export const hash: GroupSpec = {
	id: "std-hash",
	name: "Hash",
	aliases: ["Random", "White Noise", "PCG", "Integer Hash", "Random Vector"],
	category: "texture",
	...helpers(),
	build: (g) => {
		const t = g.typeVariable("t", "T", CELL_TYPES);
		const value = g.input("value", t, { label: "Value" });
		const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
		const int = (n: number) => g.constant("i32", n);
		const round = (v: Ref): Ref => {
			const { x, y, z, w } = g.split(v);
			const x1 = g.add(x, g.mul(y, w));
			const y1 = g.add(y, g.mul(z, x1));
			const z1 = g.add(z, g.mul(x1, y1));
			const w1 = g.add(w, g.mul(y1, z1));
			return g.vec("vec4i", x1, y1, z1, w1);
		};
		const padded = g.frame(
			"Padding",
			{
				note: "Zeros past the value's own components, so a cell hashes\nthe same whatever its dimensions; a scalar would be spread.",
			},
			() =>
				g.match(
					g.componentCount(value),
					{ 1: g.vec("vec4i", value, 0, 0, 0), 2: value, 3: value, 4: value },
					"vec4i",
				),
		);
		const start = g.frame(
			"Seed",
			{ note: "Spread the value, as a linear congruential generator would." },
			() => g.add(g.mul(padded, int(1664525)), int(1013904223), seed),
		);
		const mixed = g.frame(
			"First round",
			{
				note: "Each component plus the product of two others,\nthen the high bits folded in.",
			},
			() => {
				const first = round(start);
				return g.bitwise(first, "^", g.shift(first, ">>", 16));
			},
		);
		g.frame(
			"Second round",
			{ note: "Again, then the sign bit dropped and scaled to [0, 1]." },
			() => {
				const second = round(mixed);
				const positive = g.bitwise(second, "&", 2147483647);
				g.output("hash", g.mul(g.toFloat(positive), 1 / 2147483647), "vec4f", {
					label: "Hash",
				});
			},
		);
	},
};

export const latticeNeighbor: GroupSpec = {
	id: "std-lattice-neighbor",
	name: "Lattice Neighbor",
	aliases: ["Neighbor Cell", "Cell Offset", "Grid Neighbor"],
	category: "texture",
	...helpers(),
	build: (g) => {
		const t = coordinatesType(g);
		const index = g.input("index", "i32", { label: "Index", default: 0 });
		const cell = g.input("cell", t, { label: "Cell" });
		const radius = g.input("radius", "i32", { label: "Radius", default: 1, min: 0 });
		const int = (n: number) => g.constant("i32", n);
		const side = g.add(g.mul(radius, int(2)), int(1));
		const side2 = g.mul(side, side);
		const side3 = g.mul(side2, side);
		const side4 = g.mul(side3, side);
		const count = g.match(g.componentCount(cell), { 1: side, 2: side2, 3: side3, 4: side4 });
		const { offset } = g.frame(
			"Offset",
			{
				note: "The index's digits in base 2 × Radius + 1, x first,\nas many as Cell has components.",
			},
			() => {
				const digits = g.mod(g.div(index, g.vec("vec4i", 1, side, side2, side3)), side);
				return { offset: g.toFloat(g.sub(digits, radius)) };
			},
		);
		g.output("offset", offset, t, { label: "Offset" });
		g.output("neighbor", g.add(cell, offset), t, { label: "Neighbor" });
		g.output("count", count, "i32", { label: "Count" });
	},
};
