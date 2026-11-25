// Drawing flow textures: a color wheel for directions, and arrows on a grid.
import { group, type GroupBuilder, helpers } from "../../builder";
import { color } from "../color";
import { latticeNeighbor } from "../noise/lattice";

/** Sample Texture's Clamp extension. */
const CLAMP = 0;

/** Angle (radians) of an arrow head's barbs from the shaft, and their length in thicknesses. */
const BARB_ANGLE = 0.5;
const BARB_LENGTH = 4;
/** Shorter motion than this (in height units) draws no arrow. */
const MIN_ARROW = 1e-6;

/**
 * Direction and size as a color: hue from the angle (0 is rightwards, turning
 * counterclockwise), saturation from the length over `max`, white at rest.
 * `vector` is in fractions of the height.
 */
const flowWheel = group({
	id: "std-flow-wheel",
	name: "Flow Wheel",
	aliases: ["Direction Wheel", "Motion Wheel"],
	category: "color",
	...helpers("Motion"),
	inputs: ["vector", "max"],
	outputs: ["color"],
	build: (g) => {
		const vector = g.input("vector", "vec2f", { label: "Vector" });
		const max = g.input("max", "f32", { label: "Max", default: 0.1, min: 0 });
		const { x, y } = g.separateVector(vector);
		const length = g.length(vector);
		// atan2 of (0, 0) is undefined; a zero vector's hue doesn't matter, its saturation is 0.
		const isZero = g.compare(length, 0, { op: "<=" });
		const angle = g.atan2(y, g.add(x, g.switch(isZero, 0, 1)));
		const hue = g.fract(g.div(angle, 2 * Math.PI));
		// Clamping a zero max to a tiny one keeps the division finite.
		const saturation = g.min(g.div(length, g.max(max, 1e-9)), 1);
		const { color: rgb } = g.call(color, { mode: 1, hue, saturation, value: 1 });
		g.output("color", rgb, "vec3f", { label: "Color" });
	},
});

/**
 * The canvas in fractions of its height: `aspect` turns UV into those units
 * (`vec2f(aspect, 1)`), `pixel` is one pixel's length in them.
 */
const heightUnits = (g: GroupBuilder) => {
	const { x, y } = g.separateVector(g.resolution());
	return { aspect: g.vec("vec2f", g.div(x, y), 1), pixel: g.div(1, y) };
};

export const flowToColor = group({
	id: "std-flow-to-color",
	name: "Flow to Color",
	aliases: ["Flow Colour", "Motion Colour", "Direction Colour", "Flow Hue"],
	category: "color",
	section: ["Motion"],
	inputs: ["flow", "max"],
	outputs: ["color"],
	build: (g) => {
		const flow = g.input("flow", "texture", { label: "Flow" });
		const max = g.input("max", "f32", { label: "Max", default: 0.1, min: 0 });
		const { aspect } = heightUnits(g);
		const { color: vector } = g.sampleTexture(flow, g.uv(), 0, CLAMP, 0);
		const { x, y } = g.separateVector(vector);
		const motion = g.frame(
			"Motion",
			{ note: "The vector in fractions of the height, as the other sizes are." },
			() => g.mul(g.vec("vec2f", x, y), aspect),
		);
		const { color: rgb } = g.call(flowWheel, { vector: motion, max });
		g.output("color", rgb, "vec3f", { label: "Color" });
	},
});

export const flowLegend = group({
	id: "std-flow-legend",
	name: "Flow Legend",
	aliases: ["Direction Legend", "Flow Key", "Motion Legend"],
	category: "color",
	section: ["Motion"],
	inputs: [],
	outputs: ["color"],
	build: (g) => {
		const { aspect, pixel } = heightUnits(g);
		// The circle through the middle of the height is the largest, with `max` 0.5.
		const offset = g.frame(
			"Offset",
			{ note: "From the centre, in fractions of the height." },
			() => g.mul(g.sub(g.uv(), g.vec("vec2f", 0.5, 0.5)), aspect),
		);
		const { color: rgb } = g.call(flowWheel, { vector: offset, max: 0.5 });
		const { x, y, z } = g.separateVector(rgb);
		const distance = g.length(offset);
		const alpha = g.clamp(g.add(g.div(g.sub(0.5, distance), pixel), 0.5), 0, 1);
		g.output("color", g.vec("vec4f", x, y, z, alpha), "vec4f", { label: "Color" });
	},
});

export const motionArrows = group({
	id: "std-motion-arrows",
	name: "Motion Arrows",
	aliases: ["Flow Arrows", "Vector Field", "Arrows"],
	category: "texture",
	section: ["Motion"],
	inputs: ["color", "flow", "cell", "scale", "thickness", "arrow"],
	outputs: ["color"],
	build: (g) => {
		const colorInput = g.input("color", "texture", { label: "Color" });
		const flow = g.input("flow", "texture", { label: "Flow" });
		const cell = g.input("cell", "f32", { label: "Cell", default: 0.05, min: 0.001 });
		const scale = g.input("scale", "f32", { label: "Scale", default: 1, min: 0 });
		const thickness = g.input("thickness", "f32", {
			label: "Thickness",
			default: 0.004,
			min: 0,
		});
		const arrow = g.input("arrow", "vec3f", {
			label: "Arrow Color",
			default: { x: 1, y: 1, z: 1 },
		});

		const { aspect, pixel } = heightUnits(g);
		// Positions are in fractions of the height; `point` is this pixel's.
		const point = g.mul(g.uv(), aspect);
		const cellOf = g.floor(g.div(point, cell));
		const halfCell = g.vec("vec2f", 0.5, 0.5);
		const barbCos = Math.cos(BARB_ANGLE);
		const barbSin = Math.sin(BARB_ANGLE);

		// Each pixel looks at the 3×3 cells around its own: an arrow starts at its
		// cell's centre and is at most a cell long (the shaft is clamped), so it can reach into these.
		const { Coverage: coverage } = g.repeat(9, { Coverage: ["f32", 0] }, (iteration, state) => {
			const { offset } = g.call(latticeNeighbor, {
				index: iteration,
				cell: cellOf,
				radius: 1,
			});
			const centre = g.mul(g.add(g.add(cellOf, offset), halfCell), cell);
			const { color: sampled } = g.sampleTexture(flow, g.div(centre, aspect), 0, CLAMP, 0);
			const { x, y } = g.separateVector(sampled);
			const scaled = g.mul(g.mul(g.vec("vec2f", x, y), aspect), scale);
			// The 3x3 search can't see further than a cell, so a longer arrow would be cut.
			const shaft = g.mul(scaled, g.min(g.div(cell, g.max(g.length(scaled), 1e-12)), 1));
			const length = g.length(shaft);
			const direction = g.div(shaft, g.max(length, 1e-12));
			const { x: ux, y: uy } = g.separateVector(direction);
			const normal = g.vec("vec2f", g.negate(uy), ux);
			const head = g.add(centre, shaft);
			const barbLength = g.min(g.mul(thickness, BARB_LENGTH), length);
			const back = g.mul(direction, g.mul(barbLength, -barbCos));
			const side = g.mul(normal, g.mul(barbLength, barbSin));
			const barbA = g.add(back, side);
			const barbB = g.sub(back, side);

			// Coverage of a stroke of the thickness, with its edge a pixel wide.
			const stroke = (from: typeof centre, to: typeof centre) => {
				const along = g.sub(to, from);
				const away = g.sub(point, from);
				const t = g.clamp(
					g.div(g.dot(away, along), g.max(g.dot(along, along), 1e-12)),
					0,
					1,
				);
				const distance = g.length(g.sub(away, g.mul(along, t)));
				const half = g.div(thickness, 2);
				return g.sub(
					1,
					g.smoothstep(
						g.sub(half, g.div(pixel, 2)),
						g.add(half, g.div(pixel, 2)),
						distance,
					),
				);
			};
			const drawn = g.max(
				g.max(stroke(centre, head), stroke(head, g.add(head, barbA))),
				stroke(head, g.add(head, barbB)),
			);
			// Motion too small to see draws no arrow.
			const visible = g.step(MIN_ARROW, length);
			return { Coverage: g.max(state.Coverage, g.mul(drawn, visible)) };
		});

		const { color: below } = g.sampleTexture(colorInput, g.uv(), 0, CLAMP, 0);
		const { x, y, z, w } = g.separateVector(below);
		const rgb = g.mix(g.vec("vec3f", x, y, z), arrow, coverage);
		const { x: r, y: green, z: blue } = g.separateVector(rgb);
		g.output("color", g.vec("vec4f", r, green, blue, w), "vec4f", { label: "Color" });
	},
});

export default [flowWheel, flowToColor, flowLegend, motionArrows];
