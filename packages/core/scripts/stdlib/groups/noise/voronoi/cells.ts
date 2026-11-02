// Voronoi's cells: one point per lattice cell, moved at random, and the
// searches through the cells around a position.
import { group, type GroupBuilder, type Ref } from "../../../builder";
import { coordinatesType } from "../coordinates";
import { hash, latticeNeighbor } from "../lattice";
import { metricInputs, VORONOI_HELPERS, voronoiBisector, voronoiDistance } from "./metric";

/** XORed into the seed for the cells' colours, so they don't follow their points. */
export const COLOR_SALT = 1540483477;

/** Hash's components in [0, 1] for the cell at `cell` (a float vector of whole numbers). */
export function cellHash(g: GroupBuilder, cell: Ref, seed: Ref): Ref {
	return g.call(hash, { value: g.toInt(cell), seed }).hash;
}

export const voronoiPoint = group({
	id: "std-voronoi-point",
	inputs: ["cell", "offset", "randomness", "seed"],
	outputs: ["point", "neighbor"],
	name: "Voronoi Point",
	aliases: ["Feature Point", "Jittered Point", "Cell Point"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const cell = g.input("cell", t, { label: "Cell" });
		const offset = g.input("offset", t, { label: "Offset" });
		const randomness = g.input("randomness", "f32", { label: "Randomness", default: 1 });
		const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
		const neighbor = g.add(cell, offset);
		const jitter = cellHash(g, neighbor, seed);
		g.output("point", g.add(offset, g.mul(jitter, randomness)), t, { label: "Point" });
		g.output("neighbor", neighbor, t, { label: "Neighbor Cell" });
	},
});

/** How the points of the cells around `cell` are placed. */
export type PointInputs = { cell: Ref; randomness: Ref; seed: Ref };

function pointInputs(g: GroupBuilder, cell: Ref): PointInputs {
	const randomness = g.input("randomness", "f32", { label: "Randomness", default: 1 });
	const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
	return { cell, randomness, seed };
}

/**
 * The inputs of the helpers searching the cells around a position: the cell
 * it's in, where it is in that cell, and how its points are placed.
 */
function cellInputs(g: GroupBuilder) {
	const t = coordinatesType(g);
	const cell = g.input("cell", t, { label: "Cell" });
	const local = g.input("local", t, { label: "Local Position" });
	return { t, local, ...pointInputs(g, cell) };
}

/** Looking around a cell: its neighbours and their points. */
function lattice(g: GroupBuilder, { cell, randomness, seed }: PointInputs) {
	const pointAt = (offset: Ref) => g.call(voronoiPoint, { cell, offset, randomness, seed }).point;
	return {
		neighbors: (radius: number) => g.call(latticeNeighbor, { cell, radius }).count,
		pointAt,
		neighborPoint: (iteration: Ref, radius = 1) => {
			const { offset } = g.call(latticeNeighbor, {
				index: iteration,
				cell,
				radius,
			});
			return { offset, point: pointAt(offset) };
		},
	};
}

export const voronoiNearest = group({
	id: "std-voronoi-nearest",
	inputs: ["cell", "local", "randomness", "seed", "metric", "exponent"],
	outputs: ["f1-distance", "f2-distance", "f1-point", "f2-point", "f1-offset", "f2-offset"],
	name: "Voronoi Nearest Points",
	aliases: ["F1 F2", "Closest Points", "Nearest Cells"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = cellInputs(g);
		const { metric, exponent } = metricInputs(g);
		const { neighbors, neighborPoint } = lattice(g, inputs);
		const { t } = inputs;
		const closest = g.frame(
			"Closest two points",
			{
				note: "Every point of the 3×3(×3×3) cells around: the closest is F1,\nthe one after it F2.",
			},
			() =>
				g.repeat(
					neighbors(1),
					{
						"F1 Distance": ["f32", 1e10],
						"F2 Distance": ["f32", 1e10],
						"F1 Point": [t, 0],
						"F2 Point": [t, 0],
						"F1 Offset": [t, 0],
						"F2 Offset": [t, 0],
					},
					(iteration, s) => {
						const { offset, point } = neighborPoint(iteration);
						const d = g.call(voronoiDistance, {
							a: point,
							b: inputs.local,
							metric,
							exponent,
						}).distance;
						const closer1 = g.compare(d, s["F1 Distance"], { op: "<" });
						const closer2 = g.compare(d, s["F2 Distance"], { op: "<" });
						return {
							"F1 Distance": g.min(s["F1 Distance"], d),
							"F2 Distance": g.switch(
								closer1,
								g.min(s["F2 Distance"], d),
								s["F1 Distance"],
							),
							"F1 Point": g.switch(closer1, s["F1 Point"], point),
							"F2 Point": g.switch(
								closer1,
								g.switch(closer2, s["F2 Point"], point),
								s["F1 Point"],
							),
							"F1 Offset": g.switch(closer1, s["F1 Offset"], offset),
							"F2 Offset": g.switch(
								closer1,
								g.switch(closer2, s["F2 Offset"], offset),
								s["F1 Offset"],
							),
						};
					},
				),
		);
		g.output("f1-distance", closest["F1 Distance"], "f32", { label: "F1 Distance" });
		g.output("f2-distance", closest["F2 Distance"], "f32", { label: "F2 Distance" });
		g.output("f1-point", closest["F1 Point"], t, { label: "F1 Point" });
		g.output("f2-point", closest["F2 Point"], t, { label: "F2 Point" });
		g.output("f1-offset", closest["F1 Offset"], t, { label: "F1 Offset" });
		g.output("f2-offset", closest["F2 Offset"], t, { label: "F2 Offset" });
	},
});

export const voronoiEdges = group({
	id: "std-voronoi-edges",
	inputs: [
		"cell",
		"local",
		"randomness",
		"seed",
		"metric",
		"exponent",
		"f1-point",
		"f1-offset",
		"f2-point",
		"f2-offset",
	],
	outputs: ["edge", "f2-edge"],
	name: "Voronoi Edges",
	aliases: ["Distance to Edge", "Cell Edges", "Bisectors"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = cellInputs(g);
		const { metric, exponent } = metricInputs(g);
		const { t, cell, local } = inputs;
		const f1Point = g.input("f1-point", t, { label: "F1 Point" });
		const f1Offset = g.input("f1-offset", t, { label: "F1 Offset" });
		const f2Point = g.input("f2-point", t, { label: "F2 Point" });
		const f2Offset = g.input("f2-offset", t, { label: "F2 Offset" });
		const { neighbors, pointAt } = lattice(g, inputs);
		/**
		 * The distance to the closest bisector of `point` (in the cell
		 * `offset` away) and the points of the 5×5(×5×5) cells around its
		 * own: looking around the position's cell instead would see other
		 * points across each cell line, and the edges would jump there.
		 */
		const closestBisector = (point: Ref, offset: Ref) => {
			const from = g.sub(point, local);
			return g.repeat(neighbors(2), { Distance: ["f32", 1e10] }, (iteration, s) => {
				const neighbor = g.call(latticeNeighbor, {
					index: iteration,
					cell,
					radius: 2,
				}).offset;
				const toPoint = g.sub(pointAt(g.add(offset, neighbor)), local);
				const distinct = g.compare(g.length(g.sub(toPoint, from)), 0.01, { op: ">" });
				const d = g.call(voronoiBisector, {
					a: from,
					b: toPoint,
					metric,
					exponent,
				}).distance;
				return { Distance: g.switch(distinct, s.Distance, g.min(s.Distance, d)) };
			}).Distance;
		};
		g.frame(
			"F1",
			{
				note: "The bisectors of the F1 point and the points around it,\nin the metric: the edges of its cell.",
			},
			() => {
				g.output("edge", closestBisector(f1Point, f1Offset), "f32", {
					label: "Distance to Edge",
				});
			},
		);
		g.frame(
			"F2",
			{ note: "The same around the F2 point, F1's bisector included\nfrom its far side." },
			() => {
				g.output("f2-edge", closestBisector(f2Point, f2Offset), "f32", {
					label: "F2 Distance to Edge",
				});
			},
		);
	},
});

export const voronoiRadius = group({
	id: "std-voronoi-radius",
	inputs: ["cell", "randomness", "seed", "metric", "exponent", "f1-point", "f1-offset"],
	outputs: ["radius"],
	name: "Voronoi Radius",
	aliases: ["N-Sphere Radius", "Cell Radius", "Inscribed Radius"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const inputs = pointInputs(g, g.input("cell", t, { label: "Cell" }));
		const { metric, exponent } = metricInputs(g);
		const f1Point = g.input("f1-point", t, { label: "F1 Point" });
		const f1Offset = g.input("f1-offset", t, { label: "F1 Offset" });
		const { pointAt, neighbors } = lattice(g, inputs);
		const sphere = g.frame(
			"Closest point to F1",
			{ note: "The points of the cells around F1's, its own aside, in the metric." },
			() =>
				g.repeat(neighbors(1), { Distance: ["f32", 1e10] }, (iteration, s) => {
					const { offset } = g.call(latticeNeighbor, {
						index: iteration,
						cell: inputs.cell,
					});
					const itself = g.compare(g.length(offset), 0.5, { op: "<" });
					const point = pointAt(g.add(f1Offset, offset));
					const d = g.call(voronoiDistance, {
						a: f1Point,
						b: point,
						metric,
						exponent,
					}).distance;
					return { Distance: g.switch(itself, g.min(s.Distance, d), s.Distance) };
				}),
		);
		g.frame(
			"Half-way",
			{ note: "The largest ball of the metric around F1 inside its cell." },
			() => {
				g.output("radius", g.mul(sphere.Distance, 0.5), "f32", { label: "Radius" });
			},
		);
	},
});

export const voronoiSmooth = group({
	id: "std-voronoi-smooth",
	inputs: ["cell", "local", "randomness", "seed", "metric", "exponent", "smoothness"],
	outputs: ["distance", "color", "point"],
	name: "Voronoi Smooth F1",
	aliases: ["Smooth Minimum", "Smooth Voronoi", "Smooth F1"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = cellInputs(g);
		const { metric, exponent } = metricInputs(g);
		const smoothness = g.input("smoothness", "f32", {
			label: "Smoothness",
			default: 0.5,
			min: 0,
			max: 0.5,
		});
		const { neighborPoint, neighbors } = lattice(g, inputs);
		const { t, cell, local, seed } = inputs;
		const colorSeed = g.bitwise(seed, COLOR_SALT, { op: "^" });
		const smooth = g.frame(
			"Smooth minimum",
			{
				note: "Every point of the 5×5(×5×5) cells around, blended in as they come:\nthe closer, the more, by the smoothness.",
			},
			() =>
				g.repeat(
					neighbors(2),
					{
						"Smooth Distance": ["f32", 0],
						"Smooth Color": ["vec3f", 0],
						"Smooth Point": [t, 0],
					},
					(iteration, s) => {
						const { offset, point } = neighborPoint(iteration, 2);
						const d = g.call(voronoiDistance, {
							a: point,
							b: local,
							metric,
							exponent,
						}).distance;
						const blend = g.smoothstep(
							0,
							1,
							g.add(
								0.5,
								g.mul(0.5, g.div(g.sub(s["Smooth Distance"], d), smoothness)),
							),
						);
						const h = g.switch(g.compare(iteration, 0, { op: "==" }), blend, 1);
						const correction = g.mul(smoothness, h, g.sub(1, h));
						const shared = g.div(correction, g.add(1, g.mul(3, smoothness)));
						const color = cellHash(g, g.add(cell, offset), colorSeed);
						return {
							"Smooth Distance": g.sub(g.mix(s["Smooth Distance"], d, h), correction),
							"Smooth Color": g.sub(g.mix(s["Smooth Color"], color, h), shared),
							"Smooth Point": g.sub(g.mix(s["Smooth Point"], point, h), shared),
						};
					},
				),
		);
		g.output("distance", smooth["Smooth Distance"], "f32", { label: "Smooth Distance" });
		g.output("color", smooth["Smooth Color"], "vec3f", { label: "Smooth Color" });
		g.output("point", smooth["Smooth Point"], t, { label: "Smooth Point" });
	},
});
