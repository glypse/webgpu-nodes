// Voronoi Texture and Fractal Voronoi, after Blender's (cycles/kernel/svm/voronoi.h),
// and the helper groups they're made of.
import type { EnumRef, GroupBuilder, GroupSpec, Ref } from "../builder";
import { dimensionInputs, DIMENSIONS, fractal, fractalInputs } from "../noise";

const METRICS = [
	[0, "Euclidean"],
	[1, "Manhattan"],
	[2, "Chebyshev"],
	[3, "Minkowski"],
] as const;
const MINKOWSKI = 3;

/** The weight under which the octaves left of a fractal noise are dropped. */
const INAUDIBLE = 1 / 4096;

/** XORed into the seed for the cells' colours, so they don't follow their points. */
const COLOR_SALT = 1540483477;

const HELPERS = { section: ["Helpers"], searchSection: "Helpers" };
const VORONOI_HELPERS = { section: ["Helpers", "Voronoi"], searchSection: "Helpers" };

const dimensionMask: GroupSpec = {
	id: "std-dimension-mask",
	name: "Dimension Mask",
	aliases: ["Dimensions", "Axis Mask"],
	category: "texture",
	...HELPERS,
	build: (g) => {
		const dimensions = g.enum("dimensions", DIMENSIONS, 2, { label: "Dimensions" });
		const mask = g.match(
			dimensions,
			{
				1: { x: 1, y: 0, z: 0, w: 0 },
				2: { x: 1, y: 1, z: 0, w: 0 },
				3: { x: 1, y: 1, z: 1, w: 0 },
				4: { x: 1, y: 1, z: 1, w: 1 },
			},
			"vec4f",
		);
		g.output("mask", mask, "vec4f", { label: "Mask" });
	},
};

const noiseCoordinates: GroupSpec = {
	id: "std-noise-coordinates",
	name: "Noise Coordinates",
	aliases: ["Texture Coordinates", "Noise Vector"],
	category: "texture",
	...HELPERS,
	build: (g) => {
		const { dimensions, w, vector2, vector3, vector4 } = dimensionInputs(g);
		const uv = g.uv();
		const coordinates = g.match(
			dimensions,
			{
				1: g.vec("vec4f", g.fallback(w, g.split(uv).x), 0, 0, 0),
				2: g.fallback(vector2, uv),
				3: g.fallback(vector3, uv),
				4: g.fallback(vector4, uv),
			},
			"vec4f",
		);
		g.output("coordinates", coordinates, "vec4f", { label: "Coordinates" });
	},
};

const hash: GroupSpec = {
	id: "std-hash",
	name: "Hash",
	aliases: ["Random", "White Noise", "PCG", "Integer Hash", "Random Vector"],
	category: "texture",
	...HELPERS,
	build: (g) => {
		const value = g.input("value", "vec4i", { label: "Value" });
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
		const start = g.frame(
			"Seed",
			{ note: "Spread the value, as a linear congruential generator would." },
			() => g.add(g.mul(value, int(1664525)), int(1013904223), seed),
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

const latticeNeighbor: GroupSpec = {
	id: "std-lattice-neighbor",
	name: "Lattice Neighbor",
	aliases: ["Neighbor Cell", "Cell Offset", "Grid Neighbor"],
	category: "texture",
	...HELPERS,
	build: (g) => {
		const index = g.input("index", "i32", { label: "Index", default: 0 });
		const dimensions = g.enum("dimensions", DIMENSIONS, 2, { label: "Dimensions" });
		const radius = g.input("radius", "i32", { label: "Radius", default: 1, min: 0 });
		const int = (n: number) => g.constant("i32", n);
		const side = g.add(g.mul(radius, int(2)), int(1));
		const side2 = g.mul(side, side);
		const side3 = g.mul(side2, side);
		const side4 = g.mul(side3, side);
		const count = g.match(dimensions, { 1: side, 2: side2, 3: side3, 4: side4 });
		const digits = g.mod(g.div(index, g.vec("vec4i", 1, side, side2, side3)), side);
		const { mask } = g.call<"mask">(dimensionMask, { dimensions });
		g.output("offset", g.mul(g.toFloat(g.sub(digits, radius)), mask), "vec4f", {
			label: "Offset",
		});
		g.output("count", count, "i32", { label: "Count" });
	},
};

const voronoiPoint: GroupSpec = {
	id: "std-voronoi-point",
	name: "Voronoi Point",
	aliases: ["Feature Point", "Jittered Point", "Cell Point"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const cell = g.input("cell", "vec4f", { label: "Cell" });
		const offset = g.input("offset", "vec4f", { label: "Offset" });
		const randomness = g.input("randomness", "f32", { label: "Randomness", default: 1 });
		const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
		const dimensions = g.enum("dimensions", DIMENSIONS, 2, { label: "Dimensions" });
		const neighbor = g.add(cell, offset);
		const { mask } = g.call<"mask">(dimensionMask, { dimensions });
		const jitter = g.call<"hash">(hash, { value: neighbor, seed }).hash;
		g.output("point", g.add(offset, g.mul(jitter, randomness, mask)), "vec4f", {
			label: "Point",
		});
		g.output("neighbor", neighbor, "vec4f", { label: "Neighbor Cell" });
	},
};

const voronoiDistance: GroupSpec = {
	id: "std-voronoi-distance",
	name: "Voronoi Distance",
	aliases: ["Distance Metric", "Minkowski Distance", "Manhattan Distance", "Chebyshev Distance"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const a = g.input("a", "vec4f", { label: "A" });
		const b = g.input("b", "vec4f", { label: "B" });
		const { metric, exponent } = metricInputs(g);
		const d = g.abs(g.sub(a, b));
		const { x, y, z, w } = g.split(d);
		const distance = g.match(metric, {
			0: g.length(d),
			1: g.dot(d, 1),
			2: g.max(x, y, z, w),
			3: g.pow(g.dot(g.pow(d, exponent), 1), g.div(1, exponent)),
		});
		g.output("distance", distance, "f32", { label: "Distance" });
	},
};

function metricInputs(g: GroupBuilder): { metric: EnumRef; exponent: Ref } {
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
 * The inputs of the helpers searching the cells around a point: the cell
 * it's in, where it is in that cell, and how its points are placed.
 */
function cellInputs(g: GroupBuilder) {
	const cell = g.input("cell", "vec4f", { label: "Cell" });
	const local = g.input("local", "vec4f", { label: "Local Position" });
	return { local, ...pointInputs(g, cell) };
}

/** How the points of the cells around `cell` are placed. */
function pointInputs(g: GroupBuilder, cell: Ref) {
	const randomness = g.input("randomness", "f32", { label: "Randomness", default: 1 });
	const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
	const dimensions = g.enum("dimensions", DIMENSIONS, 2, { label: "Dimensions" });
	return { cell, randomness, seed, dimensions };
}

/** Looking around a cell: its neighbours and their points. */
function lattice(g: GroupBuilder, inputs: ReturnType<typeof pointInputs>) {
	const { cell, randomness, seed, dimensions } = inputs;
	const pointAt = (offset: Ref) =>
		g.call<"point">(voronoiPoint, { cell, offset, randomness, seed, dimensions }).point;
	return {
		neighbors: (radius: number) =>
			g.call<"count">(latticeNeighbor, { dimensions, radius }).count,
		pointAt,
		neighborPoint: (iteration: Ref, radius = 1) => {
			const { offset } = g.call<"offset">(latticeNeighbor, {
				index: iteration,
				dimensions,
				radius,
			});
			return { offset, point: pointAt(offset) };
		},
	};
}

const voronoiNearest: GroupSpec = {
	id: "std-voronoi-nearest",
	name: "Voronoi Nearest Points",
	aliases: ["F1 F2", "Closest Points", "Nearest Cells"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = cellInputs(g);
		const { metric, exponent } = metricInputs(g);
		const { neighbors, neighborPoint } = lattice(g, inputs);
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
						"F1 Point": ["vec4f", 0],
						"F2 Point": ["vec4f", 0],
						"F1 Offset": ["vec4f", 0],
						"F2 Offset": ["vec4f", 0],
					},
					(iteration, s) => {
						const { offset, point } = neighborPoint(iteration);
						const d = g.call<"distance">(voronoiDistance, {
							a: point,
							b: inputs.local,
							metric,
							exponent,
						}).distance;
						const closer1 = g.compare(d, "<", s["F1 Distance"]);
						const closer2 = g.compare(d, "<", s["F2 Distance"]);
						return {
							"F1 Distance": g.min(s["F1 Distance"], d),
							"F2 Distance": g.select(
								closer1,
								g.min(s["F2 Distance"], d),
								s["F1 Distance"],
							),
							"F1 Point": g.select(closer1, s["F1 Point"], point),
							"F2 Point": g.select(
								closer1,
								g.select(closer2, s["F2 Point"], point),
								s["F1 Point"],
							),
							"F1 Offset": g.select(closer1, s["F1 Offset"], offset),
							"F2 Offset": g.select(
								closer1,
								g.select(closer2, s["F2 Offset"], offset),
								s["F1 Offset"],
							),
						};
					},
				),
		);
		g.output("f1-distance", closest["F1 Distance"], "f32", { label: "F1 Distance" });
		g.output("f2-distance", closest["F2 Distance"], "f32", { label: "F2 Distance" });
		g.output("f1-point", closest["F1 Point"], "vec4f", { label: "F1 Point" });
		g.output("f2-point", closest["F2 Point"], "vec4f", { label: "F2 Point" });
		g.output("f1-offset", closest["F1 Offset"], "vec4f", { label: "F1 Offset" });
		g.output("f2-offset", closest["F2 Offset"], "vec4f", { label: "F2 Offset" });
	},
};

const voronoiBisector: GroupSpec = {
	id: "std-voronoi-bisector",
	name: "Voronoi Bisector Distance",
	aliases: ["Bisector", "Distance to Bisector", "Cell Border Distance"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const a = g.input("a", "vec4f", { label: "A" });
		const b = g.input("b", "vec4f", { label: "B" });
		const dimensions = g.enum("dimensions", DIMENSIONS, 2, { label: "Dimensions" });
		const { metric, exponent } = metricInputs(g);
		const int = (n: number) => g.constant("i32", n);
		const toA = g.call<"distance">(voronoiDistance, { a, b: 0, metric, exponent }).distance;
		const toB = g.call<"distance">(voronoiDistance, { a: b, b: 0, metric, exponent }).distance;
		const { near, far } = g.frame(
			"Sides",
			{ note: "A and B relative to the position: which of them it's closer to." },
			() => {
				const swapped = g.compare(toB, "<", toA);
				return { near: g.select(swapped, a, b), far: g.select(swapped, b, a) };
			},
		);
		const euclidean = g.frame(
			"Euclidean",
			{ note: "Straight: the distance to the plane half-way between them." },
			() => g.abs(g.dot(g.mul(g.add(a, b), 0.5), g.normalize(g.sub(b, a)))),
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
				return g.repeat(patterns, { Distance: ["f32", 1e10] }, (iteration, s) => {
					const bits = g.mod(g.div(iteration, g.vec("vec4i", 1, 2, 4, 8)), int(2));
					const sigma = g.sub(g.mul(g.toFloat(bits), 2), 1);
					const ahead = g.compare(g.dot(sigma, g.sub(far, near)), ">=", 0);
					const d = g.mul(g.add(g.dot(g.abs(far), 1), g.dot(sigma, near)), 0.5);
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

const voronoiEdges: GroupSpec = {
	id: "std-voronoi-edges",
	name: "Voronoi Edges",
	aliases: ["Distance to Edge", "Cell Edges", "Bisectors"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = cellInputs(g);
		const { metric, exponent } = metricInputs(g);
		const f1Point = g.input("f1-point", "vec4f", { label: "F1 Point" });
		const f2Point = g.input("f2-point", "vec4f", { label: "F2 Point" });
		const { neighbors, neighborPoint } = lattice(g, inputs);
		const { local, dimensions } = inputs;
		const toClosest = g.sub(f1Point, local);
		const toSecond = g.sub(f2Point, local);
		const edges = g.frame(
			"Closest bisectors",
			{
				note: "The distance to the bisector of the F1 (or F2) point and each\nother point, in the metric: the edges of its cell. F2's include\nF1's bisector, from its far side.",
			},
			() =>
				g.repeat(
					neighbors(1),
					{ "Edge Distance": ["f32", 1e10], "F2 Edge Distance": ["f32", 1e10] },
					(iteration, s) => {
						const toPoint = g.sub(neighborPoint(iteration).point, local);
						const toBisector = (from: Ref, current: Ref) => {
							const across = g.sub(toPoint, from);
							const distinct = g.compare(g.dot(across, across), ">", 0.0001);
							const d = g.call<"distance">(voronoiBisector, {
								a: from,
								b: toPoint,
								dimensions,
								metric,
								exponent,
							}).distance;
							return g.select(distinct, current, g.min(current, d));
						};
						return {
							"Edge Distance": g.frame("F1", {}, () =>
								toBisector(toClosest, s["Edge Distance"]),
							),
							"F2 Edge Distance": g.frame("F2", {}, () =>
								toBisector(toSecond, s["F2 Edge Distance"]),
							),
						};
					},
				),
		);
		g.output("edge", edges["Edge Distance"], "f32", { label: "Distance to Edge" });
		g.output("f2-edge", edges["F2 Edge Distance"], "f32", { label: "F2 Distance to Edge" });
	},
};

const voronoiRadius: GroupSpec = {
	id: "std-voronoi-radius",
	name: "Voronoi Radius",
	aliases: ["N-Sphere Radius", "Cell Radius", "Inscribed Radius"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = pointInputs(g, g.input("cell", "vec4f", { label: "Cell" }));
		const { metric, exponent } = metricInputs(g);
		const f1Point = g.input("f1-point", "vec4f", { label: "F1 Point" });
		const f1Offset = g.input("f1-offset", "vec4f", { label: "F1 Offset" });
		const { pointAt, neighbors } = lattice(g, inputs);
		const sphere = g.frame(
			"Closest point to F1",
			{ note: "The points of the cells around F1's, its own aside, in the metric." },
			() =>
				g.repeat(neighbors(1), { Distance: ["f32", 1e10] }, (iteration, s) => {
					const { offset } = g.call<"offset">(latticeNeighbor, {
						index: iteration,
						dimensions: inputs.dimensions,
					});
					const itself = g.compare(g.dot(offset, offset), "<", 0.5);
					const point = pointAt(g.add(f1Offset, offset));
					const d = g.call<"distance">(voronoiDistance, {
						a: f1Point,
						b: point,
						metric,
						exponent,
					}).distance;
					return { Distance: g.select(itself, g.min(s.Distance, d), s.Distance) };
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
};

const voronoiSmooth: GroupSpec = {
	id: "std-voronoi-smooth",
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
		const { cell, local, seed } = inputs;
		const colorSeed = g.bitwise(seed, "^", COLOR_SALT);
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
						"Smooth Point": ["vec4f", 0],
					},
					(iteration, s) => {
						const { offset, point } = neighborPoint(iteration, 2);
						const d = g.call<"distance">(voronoiDistance, {
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
						const h = g.select(g.compare(iteration, "==", 0), blend, 1);
						const correction = g.mul(smoothness, h, g.sub(1, h));
						const shared = g.div(correction, g.add(1, g.mul(3, smoothness)));
						const color = g.call<"hash">(hash, {
							value: g.add(cell, offset),
							seed: colorSeed,
						}).hash;
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
		g.output("point", smooth["Smooth Point"], "vec4f", { label: "Smooth Point" });
	},
};

/** Voronoi's inputs, keyed as `std-voronoi-texture` takes them. */
function voronoiInputs(g: GroupBuilder) {
	const dims = dimensionInputs(g);
	const scale = g.input("scale", "f32", { label: "Scale", default: 5 });
	const randomness = g.input("randomness", "f32", {
		label: "Randomness",
		default: 1,
		min: 0,
		max: 1,
	});
	const smoothness = g.input("smoothness", "f32", {
		label: "Smoothness",
		default: 1,
		min: 0,
		max: 1,
	});
	const { metric, exponent } = metricInputs(g);
	const seed = g.input("seed", "i32", { label: "Seed", default: 0 });
	return { ...dims, scale, randomness, smoothness, metric, exponent, seed };
}

const voronoiTexture: GroupSpec = {
	id: "std-voronoi-texture",
	name: "Voronoi Texture",
	aliases: ["Voronoi", "Worley", "Cellular Noise", "Cells", "Voronoi Noise", "F1", "F2"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const inputs = voronoiInputs(g);
		const { dimensions, w, vector2, vector3, vector4, scale, metric, exponent, seed } = inputs;

		const { cell, local, randomness, smoothness, colorSeed } = g.frame(
			"Lattice",
			{
				note: "Space is cut into cells of side 1 / Scale, each holding one point\nmoved at random by up to Randomness.",
			},
			() => {
				const { coordinates } = g.call<"coordinates">(noiseCoordinates, {
					dimensions,
					w,
					vector2,
					vector3,
					vector4,
				});
				const position = g.mul(coordinates, scale);
				const floor = g.floor(position);
				return {
					cell: g.wireless("Cell", floor),
					local: g.wireless("Local Position", g.sub(position, floor)),
					randomness: g.wireless("Randomness", g.clamp(inputs.randomness, 0, 1)),
					smoothness: g.clamp(g.mul(inputs.smoothness, 0.5), 0, 0.5),
					colorSeed: g.wireless("Color Seed", g.bitwise(seed, "^", COLOR_SALT)),
				};
			},
		);
		const lattice = { cell, local, randomness, seed, dimensions };
		const colorOf = (offset: Ref) =>
			g.call<"hash">(hash, { value: g.add(cell, offset), seed: colorSeed }).hash;
		const positionOf = (point: Ref) => g.div(g.add(cell, point), scale);

		const nearest = g.frame(
			"F1 and F2",
			{ note: "The closest point (F1) and the one after it (F2)." },
			() => {
				const nearest = g.call<
					| "f1-distance"
					| "f2-distance"
					| "f1-point"
					| "f2-point"
					| "f1-offset"
					| "f2-offset"
				>(voronoiNearest, { ...lattice, metric, exponent });
				const f1Point = g.wireless("F1 Point", nearest["f1-point"]);
				const f1Offset = g.wireless("F1 Offset", nearest["f1-offset"]);
				const f2Point = g.wireless("F2 Point", nearest["f2-point"]);
				const f1Color = g.wireless("F1 Color", colorOf(f1Offset));
				const f1Position = g.wireless("F1 Position", positionOf(f1Point));
				g.output("distance", nearest["f1-distance"], "f32", { label: "Distance" });
				g.output("color", f1Color, "vec3f", { label: "Color" });
				g.output("position", f1Position, "vec4f", { label: "Position" });
				g.output("cell", g.add(cell, f1Offset), "vec4f", { label: "Cell" });
				g.output("f2-distance", nearest["f2-distance"], "f32", { label: "F2 Distance" });
				g.output("f2-color", colorOf(nearest["f2-offset"]), "vec3f", { label: "F2 Color" });
				g.output("f2-position", positionOf(f2Point), "vec4f", { label: "F2 Position" });
				return {
					f1Point,
					f1Offset,
					f2Point,
					f1Color,
					f1Position,
					f1: nearest["f1-distance"],
				};
			},
		);

		g.frame(
			"Smooth F1",
			{ note: "F1 blended with the points around it, or F1 itself at no smoothness." },
			() => {
				const smooth = g.call<"distance" | "color" | "point">(voronoiSmooth, {
					...lattice,
					metric,
					exponent,
					smoothness,
				});
				const smoothed = g.compare(smoothness, ">", 0);
				const { mask } = g.call<"mask">(dimensionMask, { dimensions });
				g.output(
					"smooth-distance",
					g.select(smoothed, nearest.f1, smooth.distance),
					"f32",
					{
						label: "Smooth Distance",
					},
				);
				g.output(
					"smooth-color",
					g.select(smoothed, nearest.f1Color, smooth.color),
					"vec3f",
					{
						label: "Smooth Color",
					},
				);
				g.output(
					"smooth-position",
					g.select(smoothed, nearest.f1Position, positionOf(g.mul(smooth.point, mask))),
					"vec4f",
					{ label: "Smooth Position" },
				);
			},
		);

		g.frame("Edges", { note: "How far the cells' edges are." }, () => {
			const edges = g.call<"edge" | "f2-edge">(voronoiEdges, {
				...lattice,
				metric,
				exponent,
				"f1-point": nearest.f1Point,
				"f2-point": nearest.f2Point,
			});
			g.output("edge", edges.edge, "f32", { label: "Distance to Edge" });
			g.output("f2-edge", edges["f2-edge"], "f32", { label: "F2 Distance to Edge" });
		});

		g.frame("Radius", { note: "The largest ball of the metric inside F1's cell." }, () => {
			const { radius } = g.call<"radius">(voronoiRadius, {
				metric,
				exponent,
				cell,
				randomness,
				seed,
				dimensions,
				"f1-point": nearest.f1Point,
				"f1-offset": nearest.f1Offset,
			});
			g.output("radius", radius, "f32", { label: "Radius" });
		});
	},
};

/** The outputs of Voronoi Texture each octave adds up. */
type TextureOutput =
	| "distance"
	| "color"
	| "position"
	| "f2-distance"
	| "f2-color"
	| "f2-position"
	| "smooth-distance"
	| "smooth-color"
	| "smooth-position"
	| "edge"
	| "f2-edge";

const fractalOctave: GroupSpec = {
	id: "std-fractal-octave",
	name: "Fractal Octave",
	aliases: ["fBm Octave", "Octave", "Fractal Brownian Motion"],
	category: "texture",
	...HELPERS,
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
				note: "Its scale and weight; the octave past Detail's\nwhole part counts for its fraction.",
			},
			() => {
				const weight = g.clamp(g.add(g.sub(detail, octave), 1), 0, 1);
				g.output("scale", g.pow(lacunarity, octave), "f32", { label: "Scale" });
				g.output("amplitude", g.mul(g.pow(roughness, octave), weight), "f32", {
					label: "Amplitude",
				});
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
				const fading = g.compare(roughness, "<", 1);
				g.output("octaves", g.select(fading, detailed, g.min(detailed, needed)), "i32", {
					label: "Octaves",
				});
			},
		);
	},
};

const fractalVoronoi: GroupSpec = {
	id: "std-fractal-voronoi",
	name: "Fractal Voronoi",
	aliases: ["Voronoi fBm", "Voronoi FBM", "Fractal Worley", "Voronoi Texture", "Cellular fBm"],
	category: "texture",
	build: (g) => {
		const inputs = voronoiInputs(g);
		const octaves = fractalInputs(g);
		const normalize = g.input("normalize", "bool", { label: "Normalize", default: false });
		const { dimensions, metric, exponent } = inputs;

		const { reach, farthest } = g.frame(
			"Reach",
			{ note: "How far a point can be from its cell's centre, to normalize by." },
			() => {
				const randomness = g.clamp(inputs.randomness, 0, 1);
				const reach = g.wireless("Reach", g.add(0.5, g.mul(0.5, randomness)));
				const { mask } = g.call<"mask">(dimensionMask, { dimensions });
				const farthest = g.named(
					"Max Distance",
					g.call<"distance">(voronoiDistance, {
						a: 0,
						b: g.mul(mask, reach),
						metric,
						exponent,
					}).distance,
				);
				return { reach, farthest: g.wireless("Max Distance", farthest) };
			},
		);

		const sum = g.frame(
			"Octaves",
			{
				note: "Voronoi Texture again at each octave, its scale growing by\nLacunarity and its weight shrinking by Roughness, summed.",
			},
			() =>
				fractal(
					g,
					octaves,
					{
						Distance: ["f32", 0],
						Color: ["vec3f", 0],
						Position: ["vec4f", 0],
						"F2 Distance": ["f32", 0],
						"F2 Color": ["vec3f", 0],
						"F2 Position": ["vec4f", 0],
						"Smooth Distance": ["f32", 0],
						"Smooth Color": ["vec3f", 0],
						"Smooth Position": ["vec4f", 0],
						"Total Amplitude": ["f32", 0],
						"Edge Distance": ["f32", 8],
						"F2 Edge Distance": ["f32", 8],
						"Edge Max": ["f32", reach],
					},
					({ scale, amplitude }, s) => {
						const v = g.call<TextureOutput>(voronoiTexture, {
							...inputs,
							scale: g.mul(inputs.scale, scale),
						});
						const accumulate = (key: keyof typeof s, octave: Ref) =>
							g.add(s[key], g.mul(octave, amplitude));
						const blend = (key: keyof typeof s, octave: Ref) =>
							g.mix(s[key], octave, amplitude);
						const closer = (key: keyof typeof s, octave: Ref) =>
							g.mix(s[key], g.min(s[key], g.div(octave, scale)), amplitude);
						const f1 = g.frame("F1", {}, () => ({
							Distance: accumulate("Distance", v.distance),
							Color: accumulate("Color", v.color),
							Position: blend("Position", v.position),
						}));
						const f2 = g.frame("F2", {}, () => ({
							"F2 Distance": accumulate("F2 Distance", v["f2-distance"]),
							"F2 Color": accumulate("F2 Color", v["f2-color"]),
							"F2 Position": blend("F2 Position", v["f2-position"]),
						}));
						const smooth = g.frame("Smooth F1", {}, () => ({
							"Smooth Distance": accumulate("Smooth Distance", v["smooth-distance"]),
							"Smooth Color": accumulate("Smooth Color", v["smooth-color"]),
							"Smooth Position": blend("Smooth Position", v["smooth-position"]),
						}));
						const edges = g.frame(
							"Edges",
							{ note: "The closest edge of any octave, faded in by its weight." },
							() => ({
								"Edge Distance": closer("Edge Distance", v.edge),
								"F2 Edge Distance": closer("F2 Edge Distance", v["f2-edge"]),
								"Edge Max": g.mix(s["Edge Max"], g.div(reach, scale), amplitude),
							}),
						);
						return {
							...f1,
							...f2,
							...smooth,
							"Total Amplitude": g.add(s["Total Amplitude"], amplitude),
							...edges,
						};
					},
				),
		);

		const total = g.wireless("Total Amplitude", sum["Total Amplitude"]);
		const normalized = (value: Ref, by: Ref) => g.select(normalize, value, g.div(value, by));
		const distanceRange = g.wireless("Distance Range", g.mul(total, farthest));
		g.frame("F1", { note: "Divided by their greatest, when normalized." }, () => {
			g.output("distance", normalized(sum.Distance, distanceRange), "f32", {
				label: "Distance",
			});
			g.output("color", normalized(sum.Color, total), "vec3f", { label: "Color" });
			g.output("position", sum.Position, "vec4f", { label: "Position" });
		});
		g.frame("F2", {}, () => {
			g.output(
				"f2-distance",
				normalized(sum["F2 Distance"], g.mul(distanceRange, 2)),
				"f32",
				{
					label: "F2 Distance",
				},
			);
			g.output("f2-color", normalized(sum["F2 Color"], total), "vec3f", {
				label: "F2 Color",
			});
			g.output("f2-position", sum["F2 Position"], "vec4f", { label: "F2 Position" });
		});
		g.frame("Smooth F1", {}, () => {
			g.output("smooth-distance", normalized(sum["Smooth Distance"], distanceRange), "f32", {
				label: "Smooth Distance",
			});
			g.output("smooth-color", normalized(sum["Smooth Color"], total), "vec3f", {
				label: "Smooth Color",
			});
			g.output("smooth-position", sum["Smooth Position"], "vec4f", {
				label: "Smooth Position",
			});
		});
		g.frame("Edges", {}, () => {
			const edgeMax = sum["Edge Max"];
			g.output("edge", normalized(sum["Edge Distance"], edgeMax), "f32", {
				label: "Distance to Edge",
			});
			g.output("f2-edge", normalized(sum["F2 Edge Distance"], edgeMax), "f32", {
				label: "F2 Distance to Edge",
			});
		});
		g.frame("First octave", { note: "Not fractal: the first octave's." }, () => {
			const first = g.call<"cell" | "radius">(voronoiTexture, inputs);
			g.output("cell", first.cell, "vec4f", { label: "Cell" });
			g.output("radius", first.radius, "f32", { label: "Radius" });
		});
	},
};

export default [
	dimensionMask,
	noiseCoordinates,
	hash,
	latticeNeighbor,
	voronoiPoint,
	voronoiDistance,
	voronoiNearest,
	voronoiBisector,
	voronoiEdges,
	voronoiRadius,
	voronoiSmooth,
	voronoiTexture,
	fractalOctave,
	fractalVoronoi,
];
