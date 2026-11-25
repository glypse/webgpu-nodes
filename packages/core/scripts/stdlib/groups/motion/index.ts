// Building blocks for motion estimation. Flow textures hold a motion vector
// in rg, in UV units with y up: what is at uv now was at uv - v before.
import { EXTENSIONS } from "../../../../src/nodes/texture";
import { group, type Ref } from "../../builder";
import flow from "./flow";
import { CLAMP, luma } from "./luma";
import opticalFlow from "./optical-flow";

const EDGES = EXTENSIONS.map((v) => [v.value, v.label] as const);

export const previousFrame = group({
	id: "std-previous-frame",
	name: "Previous Frame",
	aliases: ["Last Frame", "Delay Frame", "Feedback", "History"],
	category: "texture",
	section: ["Motion"],
	inputs: ["texture"],
	outputs: ["previous", "current"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		// Previous is a second item, holding last frame's input, because a value read
		// straight from the zone's start can't leave the zone.
		const { image: current, previous } = g.simulation(
			{
				image: { type: "texture", initial: texture, size: { like: texture } },
				previous: { type: "texture", initial: texture, size: { like: texture } },
			},
			(_, state) => ({ image: texture, previous: state.image }),
		);
		g.output("previous", previous, "texture", { label: "Previous" });
		g.output("current", current, "texture", { label: "Current" });
	},
});

const imageGradient = group({
	id: "std-image-gradient",
	name: "Image Gradient",
	aliases: ["Gradient", "Derivative", "Edges", "Sobel", "Scharr"],
	category: "texture",
	section: ["Motion"],
	inputs: ["texture", "level", "scharr"],
	outputs: ["gradient"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const level = g.input("level", "i32", { label: "Level", default: 0, min: 0 });
		const scharr = g.toggle("scharr", 0, { label: "Scharr" });
		const { texel, uv } = g.frame(
			"Sampling",
			{
				note: "The gradient is per texel of the level read, not of the canvas: the texel size\nis the texture's at that level, and y points up, as UV does.",
			},
			() => ({ texel: g.textureSize(texture, level).texel, uv: g.uv() }),
		);
		const { x: stepX, y: stepY } = g.separateVector(texel);

		const lumaAt = (at: Ref): Ref => {
			const { color } = g.sampleTexture(texture, at, 0, CLAMP, level);
			const { x, y, z } = g.separateVector(color);
			return g.call(luma, { rgb: g.vec("vec3f", x, y, z) }).luma;
		};
		const offset = (dx: Ref, dy: Ref) => g.add(uv, g.vec("vec2f", dx, dy));
		// The luma change across a row, `dy` texels up or down.
		const acrossX = (dy: number) => {
			const row = g.mul(stepY, dy);
			return g.sub(lumaAt(offset(stepX, row)), lumaAt(offset(g.negate(stepX), row)));
		};
		// The luma change up a column, `dx` texels across.
		const acrossY = (dx: number) => {
			const column = g.mul(stepX, dx);
			return g.sub(lumaAt(offset(column, stepY)), lumaAt(offset(column, g.negate(stepY))));
		};
		// Scharr weights each row or column 3, 10, 3, over 32: the same change per texel as
		// the central difference on a ramp.
		const weighted = (across: (at: number) => Ref) =>
			g.div(
				g.add(g.add(g.mul(3, across(-1)), g.mul(10, across(0))), g.mul(3, across(1))),
				32,
			);
		const gradientX = g.match(scharr, {
			0: g.div(acrossX(0), 2),
			1: weighted(acrossX),
		});
		const gradientY = g.match(scharr, {
			0: g.div(acrossY(0), 2),
			1: weighted(acrossY),
		});
		g.output("gradient", g.vec("vec2f", gradientX, gradientY), "vec2f", {
			label: "Gradient",
		});
	},
});

export const warp = group({
	id: "std-warp",
	name: "Warp",
	aliases: ["Displace", "Distort", "Advect", "Flow Warp"],
	category: "texture",
	section: ["Motion"],
	inputs: ["texture", "flow", "amount", "edges"],
	outputs: ["color"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const flow = g.input("flow", "texture", { label: "Flow" });
		const amount = g.input("amount", "f32", { label: "Amount", default: 1 });
		const edges = g.enum("edges", EDGES, CLAMP, { label: "Edges" });
		const uv = g.uv();
		const displaced = g.frame(
			"Displacement",
			{ note: "The flow at the pixel, scaled by the amount, taken back from its UV." },
			() => {
				const { color: vector } = g.sampleTexture(flow, uv, 0, edges, 0);
				const { x, y } = g.separateVector(vector);
				return g.sub(uv, g.mul(g.vec("vec2f", x, y), amount));
			},
		);
		const { color } = g.sampleTexture(texture, displaced, 0, edges, 0);
		g.output("color", color, "vec4f", { label: "Color" });
	},
});

export const flowError = group({
	id: "std-flow-error",
	name: "Flow Error",
	aliases: ["Motion Error", "Warp Error", "Temporal Error", "Compensation Error"],
	category: "texture",
	section: ["Motion"],
	inputs: ["previous", "current", "flow"],
	outputs: ["error"],
	build: (g) => {
		const previous = g.input("previous", "texture", { label: "Previous" });
		const current = g.input("current", "texture", { label: "Current" });
		const flowTexture = g.input("flow", "texture", { label: "Flow" });
		const lumaOf = (color: Ref): Ref => {
			const { x, y, z } = g.separateVector(color);
			return g.call(luma, { rgb: g.vec("vec3f", x, y, z) }).luma;
		};
		const { color: now } = g.sampleTexture(current, g.uv(), 0, CLAMP, 0);
		const { color: warped } = g.call(warp, { texture: previous, flow: flowTexture });
		g.output("error", g.abs(g.sub(lumaOf(now), lumaOf(warped))), "f32", { label: "Error" });
	},
});

export default [luma, previousFrame, imageGradient, warp, ...flow, flowError, ...opticalFlow];
