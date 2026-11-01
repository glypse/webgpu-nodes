// Voronoi Texture and Fractal Voronoi, after Blender's (cycles/kernel/svm/voronoi.h).
import type { GroupBuilder, GroupSpec, Ref } from "../../../builder";
import { coordinatesInput, noiseCoordinates } from "../coordinates";
import { fractal, fractalInputs } from "../fractal";
import {
	cellHash,
	COLOR_SALT,
	voronoiEdges,
	voronoiNearest,
	voronoiRadius,
	voronoiSmooth,
} from "./cells";
import { farthestInCell, metricInputs, VORONOI_HELPERS } from "./metric";

/**
 * Voronoi's inputs, keyed as `std-voronoi-texture` takes them, and the type
 * of its coordinates (`t`).
 */
function voronoiInputs(g: GroupBuilder) {
	const { t, vector } = coordinatesInput(g);
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
	return { t, vector, scale, randomness, smoothness, metric, exponent, seed };
}

export const voronoiTexture: GroupSpec = {
	id: "std-voronoi-texture",
	name: "Voronoi Texture",
	aliases: ["Voronoi", "Worley", "Cellular Noise", "Cells", "Voronoi Noise", "F1", "F2"],
	category: "texture",
	...VORONOI_HELPERS,
	build: (g) => {
		const { t, ...inputs } = voronoiInputs(g);
		const { vector, scale, metric, exponent, seed } = inputs;

		const { cell, local, randomness, smoothness, colorSeed } = g.frame(
			"Lattice",
			{
				note: "Space is cut into cells of side 1 / Scale, each holding one point\nmoved at random by up to Randomness, in as many dimensions\nas Vector has components.",
			},
			() => {
				const { coordinates } = g.call<"coordinates">(noiseCoordinates, { vector });
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
		const lattice = { cell, local, randomness, seed };
		const colorOf = (offset: Ref) => cellHash(g, g.add(cell, offset), colorSeed);
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
				g.output("position", f1Position, t, { label: "Position" });
				g.output("cell", g.add(cell, f1Offset), t, { label: "Cell" });
				g.output("f2-distance", nearest["f2-distance"], "f32", { label: "F2 Distance" });
				g.output("f2-color", colorOf(nearest["f2-offset"]), "vec3f", { label: "F2 Color" });
				g.output("f2-position", positionOf(f2Point), t, { label: "F2 Position" });
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
				g.output(
					"smooth-distance",
					g.select(smoothed, nearest.f1, smooth.distance),
					"f32",
					{ label: "Smooth Distance" },
				);
				g.output(
					"smooth-color",
					g.select(smoothed, nearest.f1Color, smooth.color),
					"vec3f",
					{ label: "Smooth Color" },
				);
				g.output(
					"smooth-position",
					g.select(smoothed, nearest.f1Position, positionOf(smooth.point)),
					t,
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

export const fractalVoronoi: GroupSpec = {
	id: "std-fractal-voronoi",
	name: "Fractal Voronoi",
	aliases: ["Voronoi fBm", "Voronoi FBM", "Fractal Worley", "Voronoi Texture", "Cellular fBm"],
	category: "texture",
	build: (g) => {
		const { t, ...inputs } = voronoiInputs(g);
		const octaves = fractalInputs(g);
		const normalize = g.input("normalize", "bool", { label: "Normalize", default: false });

		const { reach, farthest } = g.frame(
			"Reach",
			{
				note: "How far a point can be from its cell's centre, to normalize by:\nReach along every axis, in the metric.",
			},
			() => {
				const randomness = g.clamp(inputs.randomness, 0, 1);
				const reach = g.wireless("Reach", g.add(0.5, g.mul(0.5, randomness)));
				const farthest = g.named(
					"Max Distance",
					farthestInCell(g, inputs, g.componentCount(inputs.vector), reach),
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
						Position: [t, 0],
						"F2 Distance": ["f32", 0],
						"F2 Color": ["vec3f", 0],
						"F2 Position": [t, 0],
						"Smooth Distance": ["f32", 0],
						"Smooth Color": ["vec3f", 0],
						"Smooth Position": [t, 0],
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
			g.output("position", sum.Position, t, { label: "Position" });
		});
		g.frame("F2", {}, () => {
			g.output(
				"f2-distance",
				normalized(sum["F2 Distance"], g.mul(distanceRange, 2)),
				"f32",
				{ label: "F2 Distance" },
			);
			g.output("f2-color", normalized(sum["F2 Color"], total), "vec3f", {
				label: "F2 Color",
			});
			g.output("f2-position", sum["F2 Position"], t, { label: "F2 Position" });
		});
		g.frame("Smooth F1", {}, () => {
			g.output("smooth-distance", normalized(sum["Smooth Distance"], distanceRange), "f32", {
				label: "Smooth Distance",
			});
			g.output("smooth-color", normalized(sum["Smooth Color"], total), "vec3f", {
				label: "Smooth Color",
			});
			g.output("smooth-position", sum["Smooth Position"], t, {
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
			g.output("cell", first.cell, t, { label: "Cell" });
			g.output("radius", first.radius, "f32", { label: "Radius" });
		});
	},
};
