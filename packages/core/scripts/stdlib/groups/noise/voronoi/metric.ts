// How Voronoi measures: distances between points and to the bisector of
// two, in each of its metrics.
import {
	type EnumRef,
	type GroupBuilder,
	type GroupSpec,
	helpers,
	type Ref,
} from "../../../builder";
import { componentSum, maxComponent, padVector } from "../../vector";
import { coordinatesType } from "../coordinates";

const METRICS = [
	[0, "Euclidean"],
	[1, "Manhattan"],
	[2, "Chebyshev"],
	[3, "Minkowski"],
] as const;
const MINKOWSKI = 3;

export const VORONOI_HELPERS = helpers("Voronoi");

export function metricInputs(g: GroupBuilder): { metric: EnumRef; exponent: Ref } {
	const metric = g.enum("metric", METRICS, 0, { label: "Metric" });
	const exponent = g.input("exponent", "f32", {
		label: "Exponent",
		default: 0.5,
		min: 0,
		max: 32,
		owner: { enum: metric, value: MINKOWSKI },
	});
	return { metric, exponent };
}

/**
 * The metric's length of a vector with `dimensions` components all equal to
 * `reach`: how far a point moved by up to `reach` along every axis can be.
 */
export function farthestInCell(
	g: GroupBuilder,
	{ metric, exponent }: { metric: EnumRef; exponent: Ref },
	dimensions: EnumRef,
	reach: Ref,
): Ref {
	const n = g.toFloat(dimensions);
	const across = g.match(metric, { 0: g.sqrt(n), 1: n, 2: 1, 3: g.pow(n, g.div(1, exponent)) });
	return g.mul(reach, across);
}

const sum = (g: GroupBuilder, vector: Ref) => g.call<"sum">(componentSum, { vector }).sum;

export const voronoiDistance: GroupSpec = {
	id: "std-voronoi-distance",
	name: "Voronoi Distance",
	aliases: ["Distance Metric", "Minkowski Distance", "Manhattan Distance", "Chebyshev Distance"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const a = g.input("a", t, { label: "A" });
		const b = g.input("b", t, { label: "B" });
		const { metric, exponent } = metricInputs(g);
		const d = g.abs(g.sub(a, b));
		const distance = g.match(metric, {
			0: g.length(d),
			1: sum(g, d),
			2: g.call<"max">(maxComponent, { vector: d }).max,
			3: g.pow(sum(g, g.pow(d, exponent)), g.div(1, exponent)),
		});
		g.output("distance", distance, "f32", { label: "Distance" });
	},
};

export const voronoiBisector: GroupSpec = {
	id: "std-voronoi-bisector",
	name: "Voronoi Bisector Distance",
	aliases: ["Bisector", "Distance to Bisector", "Cell Border Distance"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const a = g.input("a", t, { label: "A" });
		const b = g.input("b", t, { label: "B" });
		const { metric, exponent } = metricInputs(g);
		const dimensions = g.componentCount(a);
		const int = (n: number) => g.constant("i32", n);
		const toA = g.call<"distance">(voronoiDistance, { a, b: 0, metric, exponent }).distance;
		const toB = g.call<"distance">(voronoiDistance, { a: b, b: 0, metric, exponent }).distance;
		const { near, far } = g.frame(
			"Sides",
			{
				note: "A and B relative to the position: which of them it's closer to,\npadded with zeros for the axis-by-axis metrics.",
			},
			() => {
				const swapped = g.compare(toB, "<", toA);
				const pad = (vector: Ref) => g.call<"padded">(padVector, { vector }).padded;
				return { near: pad(g.select(swapped, a, b)), far: pad(g.select(swapped, b, a)) };
			},
		);
		const euclidean = g.frame(
			"Euclidean",
			{ note: "Straight: the distance to the plane half-way between them." },
			() => {
				const across = g.sub(b, a);
				return g.div(g.abs(sum(g, g.mul(g.add(a, b), across, 0.5))), g.length(across));
			},
		);
		const manhattan = g.frame(
			"Manhattan",
			{
				note: "For each sign pattern σ the far point is ahead of the near one along,\n(|far|₁ + σ·near) / 2: the least is the distance.",
			},
			() => {
				const patterns = g.match(dimensions, {
					1: int(2),
					2: int(4),
					3: int(8),
					4: int(16),
				});
				const farLength = g.dot(g.abs(far), 1);
				return g.repeat(patterns, { Distance: ["f32", 1e10] }, (iteration, s) => {
					const bits = g.mod(g.div(iteration, g.vec("vec4i", 1, 2, 4, 8)), int(2));
					const sigma = g.sub(g.mul(g.toFloat(bits), 2), 1);
					const ahead = g.compare(g.dot(sigma, g.sub(far, near)), ">=", 0);
					const d = g.mul(g.add(farLength, g.dot(sigma, near)), 0.5);
					return { Distance: g.select(ahead, s.Distance, g.min(s.Distance, d)) };
				}).Distance;
			},
		);
		const chebyshev = g.frame(
			"Chebyshev",
			{
				note: "For each axis and direction the far point isn't behind on, how far\nto half-way along it, the other axes keeping up: the least is the distance.",
			},
			() => {
				const sides = g.mul(g.toInt(dimensions), int(2));
				return g.repeat(sides, { Distance: ["f32", 1e10] }, (iteration, s) => {
					const axis = g.div(iteration, int(2));
					const sign = g.sub(1, g.mul(g.toFloat(g.mod(iteration, int(2))), 2));
					const along = g.sub(
						1,
						g.min(g.abs(g.toFloat(g.sub(g.vec("vec4i", 0, 1, 2, 3), axis))), 1),
					);
					const nearK = g.dot(near, along);
					const farK = g.dot(far, along);
					const ahead = g.compare(g.mul(sign, g.sub(farK, nearK)), ">=", 0);
					const { x, y, z, w } = g.split(g.mul(g.abs(far), g.sub(1, along)));
					const others = g.mul(g.add(g.max(x, y, z, w), g.mul(sign, nearK)), 0.5);
					const d = g.max(g.mul(sign, g.add(nearK, farK), 0.5), others, 0);
					return { Distance: g.select(ahead, s.Distance, g.min(s.Distance, d)) };
				}).Distance;
			},
		);
		const minkowski = g.frame(
			"Minkowski",
			{
				note: "No closed form: half the gap between the two distances,\nexact on the edge itself, approximate away from it.",
			},
			() => g.mul(g.abs(g.sub(toB, toA)), 0.5),
		);
		g.output(
			"distance",
			g.match(metric, { 0: euclidean, 1: manhattan, 2: chebyshev, 3: minkowski }),
			"f32",
			{ label: "Distance" },
		);
	},
};
