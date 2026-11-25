// The project the editor opens with: every kind of pass and texture there
// is, drawn side by side, each in a frame saying what it shows.
import { group, type GroupBuilder, type Ref } from "../stdlib/builder";
import { flowError, previousFrame, warp } from "../stdlib/groups/motion";
import { flowLegend, flowToColor, motionArrows } from "../stdlib/groups/motion/flow";
import { CLAMP } from "../stdlib/groups/motion/luma";
import { opticalFlow } from "../stdlib/groups/motion/optical-flow";
import { fractalNoise } from "../stdlib/groups/noise/simplex/texture";

const TRANSPARENT = 3;
const LINEAR = 0;
const CLOSEST = 1;
const COLUMNS = 3;

const { PI } = Math;

/** Coordinates whose unit is the canvas' height, from its centre. */
function centred(g: GroupBuilder): Ref {
	const { x: width, y: height } = g.separateVector(g.resolution());
	const { x, y } = g.separateVector(g.sub(g.uv(), g.vec("vec2f", 0.5, 0.5)));
	return g.vec("vec2f", g.mul(x, g.div(width, height)), y);
}

/** Something to measure the motion of: a background and a disc, each moving its own way. */
export const movingPicture = group({
	id: "scene-moving-picture",
	name: "Moving Picture",
	category: "texture",
	inputs: ["speed"],
	outputs: ["color"],
	build: (g) => {
		const speed = g.input("speed", "f32", { label: "Speed", default: 1 });
		const point = centred(g);
		const time = g.mul(g.time().seconds, speed);

		const textured = (at: Ref, seed: number, low: Ref, high: Ref) => {
			const { fac } = g.call(fractalNoise, { vector: at, scale: 4, detail: 5, seed });
			return g.mix(low, high, g.smoothstep(0.25, 0.75, fac));
		};
		const background = g.frame(
			"Background",
			{ note: "Drifts sideways while it zooms in and out." },
			() => {
				const zoom = g.add(1, g.mul(g.sin(time), 0.12));
				const drift = g.vec("vec2f", g.mul(time, -0.12), g.mul(g.cos(time), 0.05));
				return textured(
					g.add(g.mul(point, zoom), drift),
					1,
					g.constant("vec3f", { x: 0.01, y: 0.02, z: 0.05 }),
					g.constant("vec3f", { x: 0.35, y: 0.5, z: 0.6 }),
				);
			},
		);
		const { colour, mask } = g.frame(
			"Disc",
			{ note: "Circles the centre, turning about its own." },
			() => {
				const orbit = g.mul(time, 0.8);
				const middle = g.mul(g.vec("vec2f", g.cos(orbit), g.sin(orbit)), 0.28);
				const { x, y } = g.separateVector(g.sub(point, middle));
				const turn = g.mul(time, -1.1);
				const cos = g.cos(turn);
				const sin = g.sin(turn);
				const turned = g.vec(
					"vec2f",
					g.sub(g.mul(x, cos), g.mul(y, sin)),
					g.add(g.mul(x, sin), g.mul(y, cos)),
				);
				return {
					colour: textured(
						g.mul(turned, 1.5),
						7,
						g.constant("vec3f", { x: 0.12, y: 0.015, z: 0.01 }),
						g.constant("vec3f", { x: 1, y: 0.55, z: 0.12 }),
					),
					mask: g.sub(1, g.smoothstep(0.19, 0.196, g.length(g.vec("vec2f", x, y)))),
				};
			},
		);
		const { x: red, y: green, z: blue } = g.separateVector(g.mix(background, colour, mask));
		g.output("color", g.vec("vec4f", red, green, blue, 1), "vec4f", { label: "Color" });
	},
});

/** The shades a texture's smallest levels average to, each twice as coarse as the last. */
export const pyramid = group({
	id: "scene-pyramid",
	name: "Pixelate by Halves",
	category: "texture",
	inputs: ["texture", "steps"],
	outputs: ["texture"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const steps = g.input("steps", "i32", { label: "Steps", default: 4, min: 0 });
		const { image } = g.repeatPasses(
			steps,
			{
				image: {
					type: "texture",
					initial: texture,
					size: (iteration) => ({
						scale: g.pow(0.5, g.toFloat(g.add(iteration, 1))),
						like: texture,
					}),
				},
			},
			// Between four texels of the texture twice the size: their mean.
			(_, state) => ({
				image: g.sampleTexture(state.image, g.uv(), LINEAR, CLAMP, 0).color,
			}),
		);
		g.output("texture", image, "texture", { label: "Texture" });
	},
});

/** A wide glow around what's brighter than a threshold, each pass reading farther than the last. */
export const glow = group({
	id: "scene-glow",
	name: "Glow",
	category: "texture",
	inputs: ["texture", "threshold", "passes", "strength"],
	outputs: ["color"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const threshold = g.input("threshold", "f32", { label: "Threshold", default: 0.3 });
		const passes = g.input("passes", "i32", { label: "Passes", default: 6, min: 0 });
		const strength = g.input("strength", "f32", { label: "Strength", default: 1.5, min: 0 });
		const rgbOf = (color: Ref): Ref => {
			const { x, y, z } = g.separateVector(color);
			return g.vec("vec3f", x, y, z);
		};
		const opaque = (rgb: Ref): Ref => {
			const { x, y, z } = g.separateVector(rgb);
			return g.vec("vec4f", x, y, z, 1);
		};
		const bright = g.frame(
			"Bright parts",
			{ note: "Half the size is enough for what's blurred." },
			() => {
				const { color } = g.sampleTexture(texture, g.uv(), LINEAR, CLAMP, 0);
				const over = g.max(g.sub(rgbOf(color), threshold), g.constant("vec3f", 0));
				return g.renderTexture(
					{ bright: { value: opaque(over) } },
					{ like: texture, scale: 0.5 },
				).bright;
			},
		);
		const { blurred } = g.repeatPasses(
			passes,
			{ blurred: { type: "texture", initial: bright, size: { like: bright } } },
			(iteration, state) => {
				const uv = g.uv();
				const reach = g.mul(
					g.textureSize(state.blurred, 0).texel,
					g.add(g.toFloat(iteration), 0.5),
				);
				const { x, y } = g.separateVector(reach);
				const corner = (sx: 1 | -1, sy: 1 | -1) =>
					rgbOf(
						g.sampleTexture(
							state.blurred,
							g.add(uv, g.vec("vec2f", g.mul(x, sx), g.mul(y, sy))),
							LINEAR,
							CLAMP,
							0,
						).color,
					);
				const sum = g.add(
					g.add(corner(1, 1), corner(-1, 1)),
					g.add(corner(1, -1), corner(-1, -1)),
				);
				return { blurred: opaque(g.mul(sum, 0.25)) };
			},
		);
		const below = rgbOf(g.sampleTexture(texture, g.uv(), LINEAR, CLAMP, 0).color);
		const above = rgbOf(g.sampleTexture(blurred, g.uv(), LINEAR, CLAMP, 0).color);
		g.output("color", opaque(g.add(below, g.mul(above, strength))), "vec4f", {
			label: "Color",
		});
	},
});

/** The exact texels around a texture's centre, drawn big, with the lines between them. */
export const texels = group({
	id: "scene-texels",
	name: "Magnify Texels",
	category: "texture",
	inputs: ["texture", "across"],
	outputs: ["color"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const across = g.input("across", "f32", { label: "Texels Across", default: 32, min: 1 });
		const { x: width, y: height } = g.separateVector(g.textureSize(texture, 0).size);
		const { x: u, y: v } = g.separateVector(g.uv());
		const shown = g.vec("vec2f", across, g.mul(across, g.div(height, width)));
		// Texels are counted from the top left.
		const { x, y } = g.separateVector(
			g.add(
				g.mul(g.vec("vec2f", width, height), 0.5),
				g.mul(g.sub(g.vec("vec2f", u, g.sub(1, v)), g.vec("vec2f", 0.5, 0.5)), shown),
			),
		);
		const texel = g.node("load-texel", {
			texture,
			texel: g.vec("vec2i", g.toInt(g.floor(x)), g.toInt(g.floor(y))),
			level: 0,
		});
		const { x: inX, y: inY } = g.separateVector(g.vec("vec2f", g.fract(x), g.fract(y)));
		const lines = g.mul(g.step(0.06, inX), g.step(0.06, inY));
		const { x: r, y: gr, z: b } = g.separateVector(texel);
		const rgb = g.mul(g.vec("vec3f", r, gr, b), g.mix(0.25, 1, lines));
		const { x: red, y: green, z: blue } = g.separateVector(rgb);
		g.output("color", g.vec("vec4f", red, green, blue, 1), "vec4f", { label: "Color" });
	},
});

/** Nine textures as a grid of tiles, or one of them whole. */
export const contactSheet = group({
	id: "scene-contact-sheet",
	name: "Contact Sheet",
	category: "texture",
	inputs: ["view", "a", "b", "c", "d", "e", "f", "g", "h", "i"],
	outputs: ["color"],
	build: (g) => {
		const view = g.input("view", "i32", { label: "View", default: 0, min: 0, max: 9 });
		const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i"] as const;
		const textures = keys.map((key, i) =>
			g.input(key, "texture", { label: `Tile ${String(i + 1)}` }),
		);
		const { x, y } = g.separateVector(g.mul(g.uv(), COLUMNS));
		const column = g.floor(x);
		const row = g.sub(COLUMNS - 1, g.floor(y));
		const tile = g.toInt(g.add(column, g.mul(row, COLUMNS)));
		const whole = g.compare(view, 0, { op: ">" });
		const inTile = g.vec("vec2f", g.fract(x), g.fract(y));
		const at = g.switch(whole, inTile, g.uv());
		const index = g.switch(whole, tile, g.sub(view, 1));
		const color = g.indexSwitch(
			index,
			textures.map((t) => g.sampleTexture(t, at, LINEAR, CLAMP, 0).color),
			"vec4f",
		);
		const edge = g.frame("Gaps", { note: "Dark lines between the tiles." }, () => {
			const { x: tx, y: ty } = g.separateVector(inTile);
			const near = (t: Ref) => g.min(t, g.sub(1, t));
			const gap = g.step(0.008, g.min(near(tx), near(ty)));
			return g.switch(whole, gap, 1);
		});
		const { x: r, y: gr, z: b } = g.separateVector(color);
		const {
			x: red,
			y: green,
			z: blue,
		} = g.separateVector(g.mul(g.vec("vec3f", r, gr, b), edge));
		g.output("color", g.vec("vec4f", red, green, blue, 1), "vec4f", { label: "Color" });
	},
});

/** The root document, its Output node standing for the group's output. */
export const root = group({
	id: "scene-root",
	name: "Scene",
	category: "texture",
	inputs: [],
	outputs: ["color"],
	build: (g) => {
		const { view, speed, tileScale } = g.frame(
			"Start here",
			{
				note: "View 0 shows every tile; 1 to 9 shows one whole. Scrub the numbers: none of them recompiles.\n\nDotted links carry values that are the same for the whole frame. Only those can set sizes, counts and times: try linking a UV to a Render Texture's scale, and hover the red link.\n\nEvery group here is yours to enter (Enter) and edit.",
			},
			() => {
				const shown = g.named("View (0 to 9)", g.constant("i32", 0));
				const whole = g.compare(shown, 0, { op: ">" });
				return {
					view: shown,
					speed: g.named("Speed", g.constant("f32", 1)),
					// A tile is a third of the canvas: its textures need little more.
					tileScale: g.wireless("tile scale", g.switch(whole, 0.4, 1)),
				};
			},
		);

		const source = g.frame(
			"1 · Picture",
			{
				note: "A Render Texture draws a value into a texture of its own: here a scale of the canvas, a frame value that follows View. The other tiles read it instead of drawing the picture again.",
			},
			() => {
				const { color } = g.call(movingPicture, { speed });
				const { picture } = g.renderTexture(
					{ picture: { value: color } },
					{ scale: tileScale },
				);
				return g.wireless("picture", picture);
			},
		);

		const { seconds, flow, frames, flowTile } = g.frame(
			"2 · Optical Flow",
			{
				note: "Previous Frame keeps the last frame in a simulation; Optical Flow estimates how far each pixel moved since, coarse to fine, in Repeat Passes zones (enter it). Hue is the direction, saturation the speed.",
			},
			() => {
				const kept = g.call(previousFrame, { texture: source });
				const estimated = g.call(opticalFlow, {
					current: kept.current,
					previous: kept.previous,
				});
				// The flow covers the time since the frame drawn before, which varies
				// when the preview falls behind the display: shown per second, the
				// colours don't flicker with it.
				const seconds = g.wireless("seconds", g.max(g.delta(), 0.001));
				const { color } = g.call(flowToColor, {
					flow: estimated.flow,
					max: g.mul(0.6, seconds),
				});
				// The legend fills the frame it's drawn over: a small one is put in the corner.
				const { legend } = g.renderTexture(
					{ legend: { value: g.call(flowLegend).color } },
					{ scale: g.mul(tileScale, 0.25) },
				);
				const { x, y, z, w } = g.separateVector(
					g.sampleTexture(legend, g.mul(g.uv(), 4), LINEAR, TRANSPARENT, 0).color,
				);
				const shown = g.mix(color, g.vec("vec3f", x, y, z), w);
				const { x: red, y: green, z: blue } = g.separateVector(shown);
				return {
					seconds,
					flow: g.wireless("flow", estimated.flow),
					frames: { current: kept.current, previous: kept.previous },
					flowTile: g.vec("vec4f", red, green, blue, 1),
				};
			},
		);

		const arrows = g.frame(
			"3 · Motion Arrows",
			{
				note: "The flow at the centre of each cell, per second like the colours, and longer than it is so it can be seen.",
			},
			() =>
				g.call(motionArrows, {
					color: source,
					flow,
					cell: 0.06,
					scale: g.div(0.13, seconds),
				}).color,
		);

		const error = g.frame(
			"4 · Flow Error",
			{
				note: "What's left between this frame and the previous one carried by the flow, 8 times brighter: black where the estimate is right. The disc's edge uncovers pixels nothing can predict.",
			},
			() => {
				const { error: difference } = g.call(flowError, { ...frames, flow });
				const grey = g.mul(difference, 8);
				return g.vec("vec4f", grey, grey, grey, 1);
			},
		);

		const trails = g.frame(
			"5 · Datamosh",
			{
				note: "A Simulation zone: its image is moved along the flow instead of redrawn, so the picture smears. A new picture fades in slowly, and the whole of it is let in again every 4 seconds.",
			},
			() => {
				const { image } = g.simulation(
					{ image: { type: "texture", initial: source, size: { like: source } } },
					(delta, state) => {
						const moved = g.call(warp, { texture: state.image, flow }).color;
						const { color } = g.sampleTexture(source, g.uv(), LINEAR, CLAMP, 0);
						const restart = g.step(g.fract(g.div(g.time().seconds, 4)), 0.02);
						const fade = g.max(g.mul(delta, 0.25), restart);
						return { image: g.mix(moved, color, fade) };
					},
				);
				return image;
			},
		);

		const mips = g.frame(
			"6 · Mip levels",
			{
				note: "A Render Texture with mips on also keeps smaller and smaller copies of itself. Sample Texture reads any level, and between two: here one that comes and goes with Time.",
			},
			() => {
				const { sharp } = g.renderTexture(
					{
						sharp: {
							value: g.sampleTexture(source, g.uv(), LINEAR, CLAMP, 0).color,
						},
					},
					{ like: source, mips: true },
				);
				const level = g.named("Level", g.mul(g.add(g.sin(g.time().seconds), 1), 2.5));
				return g.sampleTexture(sharp, g.uv(), LINEAR, CLAMP, level).color;
			},
		);

		const glowing = g.frame(
			"7 · Glow",
			{
				note: "A Repeat Passes zone (enter Glow): whole passes repeated as many times as a value says, here one that changes with Time. Each pass knows its iteration, and reads farther than the last.",
			},
			() => {
				const wave = g.add(g.sin(g.mul(g.time().seconds, 1.5)), 1);
				const passes = g.named("Passes", g.toInt(g.add(g.mul(wave, 5), 1)));
				return g.call(glow, { texture: source, passes }).color;
			},
		);

		const halves = g.frame(
			"8 · Pixelate by Halves",
			{
				note: "A Repeat Passes zone whose texture is half the size in each iteration. The result is read with the Closest filter, so its texels show.",
			},
			() => {
				const steps = g.named(
					"Steps",
					g.toInt(g.mul(g.add(g.sin(g.mul(g.time().seconds, PI / 4)), 1), 3.5)),
				);
				const { texture } = g.call(pyramid, { texture: source, steps });
				return g.sampleTexture(texture, g.uv(), CLOSEST, CLAMP, 0).color;
			},
		);

		const magnified = g.frame(
			"9 · Exact texels",
			{
				note: "A picture drawn at 64×36 pixels whatever the canvas, then read texel by texel with Load Texel.",
			},
			() => {
				const { small } = g.renderTexture(
					{ small: { value: g.sampleTexture(source, g.uv(), LINEAR, CLAMP, 0).color } },
					{ pixels: g.constant("vec2u", { x: 64, y: 36 }) },
				);
				return g.call(texels, { texture: small, across: 32 }).color;
			},
		);

		const tiles = g.frame(
			"Tiles",
			{
				note: "One Render Texture draws several values at once, as many to a pass as WebGPU lets it. Linked straight to a Texture input, each would be drawn by itself, at the canvas' size.",
			},
			() =>
				g.renderTexture(
					{
						Flow: { value: flowTile },
						Arrows: { value: arrows },
						Error: { value: error },
						Mips: { value: mips },
						Glow: { value: glowing },
						Halves: { value: halves },
						Texels: { value: magnified },
					},
					{ scale: tileScale },
				),
		);
		const { color } = g.call(contactSheet, {
			view,
			a: source,
			b: tiles.Flow,
			c: tiles.Arrows,
			d: tiles.Error,
			e: trails,
			f: tiles.Mips,
			g: tiles.Glow,
			h: tiles.Halves,
			i: tiles.Texels,
		});
		g.output("color", color, "vec4f", { label: "Color" });
	},
});
