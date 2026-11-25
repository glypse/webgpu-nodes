// Pyramidal Lucas-Kanade optical flow. Flow textures are rgba32float: the
// vector in rg (UV units, y up), the confidence in b.
import { group, helpers, type Ref } from "../../builder";
import { boxBlur1d } from "../blur/kernel";
import { CLAMP, luma } from "./luma";

/**
 * A window whose determinant is under this fraction of its trace squared has
 * texture along one direction only, or none: it can't tell its motion. A
 * fraction, as the sums shrink with the square of the image's contrast.
 */
const MIN_CONDITION = 1e-5;

/**
 * A texture's colour at `uv` and mip `level`, by Catmull-Rom cubic
 * interpolation of the 4x4 texels around it, edges clamped. Unlike bilinear
 * reads it doesn't flatten curvature, which biases small shifts.
 */
const sampleCubic = group({
	id: "std-sample-cubic",
	name: "Sample Cubic",
	aliases: ["Bicubic", "Catmull-Rom", "Cubic Interpolation"],
	category: "texture",
	...helpers("Motion"),
	inputs: ["texture", "uv", "level"],
	outputs: ["color"],
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const uv = g.input("uv", "vec2f", { label: "UV", default: { x: 0.5, y: 0.5 } });
		const level = g.input("level", "i32", { label: "Level", default: 0, min: 0 });
		const size = g.textureSize(texture, level).size;
		const { x: width, y: height } = g.separateVector(size);
		const { x: u, y: v } = g.separateVector(uv);
		// Texel coordinates, rows down, with texel centres at whole numbers.
		const px = g.sub(g.mul(u, width), 0.5);
		const py = g.sub(g.mul(g.sub(1, v), height), 0.5);
		const baseX = g.floor(px);
		const baseY = g.floor(py);
		const weights = (t: Ref): Ref[] => {
			const t2 = g.mul(t, t);
			const t3 = g.mul(t2, t);
			const half = (a: Ref, b: Ref, c: Ref, extra = 0) =>
				g.add(g.add(g.mul(a, t3), g.mul(b, t2)), g.add(g.mul(c, t), extra));
			return [
				half(g.constant("f32", -0.5), g.constant("f32", 1), g.constant("f32", -0.5)),
				half(g.constant("f32", 1.5), g.constant("f32", -2.5), g.constant("f32", 0), 1),
				half(g.constant("f32", -1.5), g.constant("f32", 2), g.constant("f32", 0.5)),
				half(g.constant("f32", 0.5), g.constant("f32", -0.5), g.constant("f32", 0)),
			];
		};
		const wx = weights(g.sub(px, baseX));
		const wy = weights(g.sub(py, baseY));
		const mip = g.toFloat(level);
		const total = (terms: Ref[]): Ref => terms.reduce((sum, term) => g.add(sum, term));
		const sum = total(
			wy.map((weightY, j) => {
				const ty = g.div(g.add(g.add(baseY, j - 1), 0.5), height);
				const taps = wx.map((weightX, k) => {
					const tx = g.div(g.add(g.add(baseX, k - 1), 0.5), width);
					const at = g.vec("vec2f", tx, g.sub(1, ty));
					return g.mul(g.sampleTexture(texture, at, 0, CLAMP, mip).color, weightX);
				});
				return g.mul(total(taps), weightY);
			}),
		);
		g.output("color", sum, "vec4f", { label: "Color" });
	},
});

const lucasKanadeStep = group({
	id: "std-lucas-kanade-step",
	name: "Lucas-Kanade Step",
	category: "texture",
	section: ["Helpers", "Motion"],
	searchSection: "Helpers",
	inputs: ["previous", "current", "flow", "level", "window"],
	outputs: ["flow"],
	build: (g) => {
		const previous = g.input("previous", "texture", { label: "Previous Luma" });
		const current = g.input("current", "texture", { label: "Current Luma" });
		const flow = g.input("flow", "texture", { label: "Flow" });
		const level = g.input("level", "i32", { label: "Level", default: 0, min: 0 });
		const window = g.input("window", "f32", { label: "Window", default: 2, min: 0 });
		const mip = g.toFloat(level);
		const perPass = (): { uv: Ref; texel: Ref } => ({
			uv: g.uv(),
			texel: g.div(1, g.resolution()),
		});

		const products = g.frame(
			"Products",
			{
				note: "The gradients of the previous frame warped by the flow so far, averaged with\nthe current frame's, and the products the window sums. The residual reads the warped\nframe by cubic interpolation. Every pass of a level is the flow's size, its texel one over that size.",
			},
			() => {
				const { uv, texel } = perPass();
				const { x: stepX, y: stepY } = g.separateVector(texel);
				const lumaAt = (texture: Ref, at: Ref): Ref =>
					g.separateVector(g.sampleTexture(texture, at, 0, CLAMP, mip).color).x;
				const flowAt = (at: Ref): Ref => {
					const { x, y } = g.separateVector(g.sampleTexture(flow, at, 0, CLAMP, 0).color);
					return g.vec("vec2f", x, y);
				};
				// The previous frame carried to `at` by the flow there.
				const warped = (at: Ref): Ref => lumaAt(previous, g.sub(at, flowAt(at)));
				const next = (at: Ref): Ref => lumaAt(current, at);
				const nudge = (dx: Ref | number, dy: Ref | number, sign: 1 | -1): Ref =>
					g.add(uv, g.vec("vec2f", g.mul(dx, sign), g.mul(dy, sign)));
				const slope = (texture: (at: Ref) => Ref, dx: Ref | number, dy: Ref | number) =>
					g.div(g.sub(texture(nudge(dx, dy, 1)), texture(nudge(dx, dy, -1))), 2);
				const gradient = (dx: Ref | number, dy: Ref | number) =>
					g.div(g.add(slope(warped, dx, dy), slope(next, dx, dy)), 2);
				const gx = gradient(stepX, 0);
				const gy = gradient(0, stepY);
				// The one value the update is the residual of, read without the flattening of bilinear reads.
				const centre = g.separateVector(
					g.call(sampleCubic, { texture: previous, uv: g.sub(uv, flowAt(uv)), level })
						.color,
				).x;
				const dt = g.sub(next(uv), centre);
				return g.renderTexture(
					{
						a: {
							value: g.vec("vec4f", g.mul(gx, gx), g.mul(gx, gy), g.mul(gy, gy), 1),
							format: "rgba32float",
						},
						b: {
							value: g.vec("vec4f", g.mul(gx, dt), g.mul(gy, dt), 0, 1),
							format: "rgba32float",
						},
					},
					{ like: flow },
				);
			},
		);

		// The kernel divides by alpha, so every item keeps it at 1.
		const mean = (sums: { a: Ref; b: Ref }, along: "x" | "y") => {
			const { texel } = perPass();
			const { x, y } = g.separateVector(texel);
			const direction = along === "x" ? g.vec("vec2f", x, 0) : g.vec("vec2f", 0, y);
			const blur = (texture: Ref) =>
				g.call(boxBlur1d, { texture, direction, radius: window, edges: 0 }).color;
			return g.renderTexture(
				{
					a: { value: blur(sums.a), format: "rgba32float" },
					b: { value: blur(sums.b), format: "rgba32float" },
				},
				{ like: flow },
			);
		};
		const across = g.frame(
			"Window means",
			{ note: "A box of `window` pixels at the level: along x, then along y." },
			() => mean(mean(products, "x"), "y"),
		);

		const solved = g.frame(
			"Solve",
			{
				note: "(Σ∇∇ᵀ) d = -Σ∇·It for the step d in pixels, y up; a window without\nthe texture to solve keeps the flow. Confidence is the smaller eigenvalue.",
			},
			() => {
				const { uv, texel } = perPass();
				const {
					x: sxx,
					y: sxy,
					z: syy,
				} = g.separateVector(g.sampleTexture(across.a, uv, 0, CLAMP, 0).color);
				const { x: sxt, y: syt } = g.separateVector(
					g.sampleTexture(across.b, uv, 0, CLAMP, 0).color,
				);
				const { x: vx, y: vy } = g.separateVector(
					g.sampleTexture(flow, uv, 0, CLAMP, 0).color,
				);
				const det = g.sub(g.mul(sxx, syy), g.mul(sxy, sxy));
				const trace = g.add(sxx, syy);
				const solvable = g.compare(det, g.mul(g.mul(trace, trace), MIN_CONDITION), {
					op: ">",
				});
				const safe = g.switch(solvable, 1, det);
				const dx = g.negate(g.div(g.sub(g.mul(syy, sxt), g.mul(sxy, syt)), safe));
				const dy = g.negate(g.div(g.sub(g.mul(sxx, syt), g.mul(sxy, sxt)), safe));
				const step = g.mul(g.vec("vec2f", dx, dy), texel);
				const moved = g.add(
					g.vec("vec2f", vx, vy),
					g.switch(solvable, g.constant("vec2f", 0), step),
				);
				const spread = g.sqrt(g.max(g.sub(g.mul(trace, trace), g.mul(det, 4)), 0));
				const { x: mx, y: my } = g.separateVector(moved);
				return g.renderTexture(
					{
						flow: {
							value: g.vec("vec4f", mx, my, g.div(g.sub(trace, spread), 2), 1),
							format: "rgba32float",
						},
					},
					{ like: flow },
				).flow;
			},
		);
		g.output("flow", solved, "texture", { label: "Flow" });
	},
});

const opticalFlow = group({
	id: "std-optical-flow",
	name: "Optical Flow",
	aliases: [
		"Motion Estimation",
		"Motion Vectors",
		"Lucas Kanade",
		"Pyramidal Lucas Kanade",
		"Velocity",
	],
	category: "texture",
	section: ["Motion"],
	inputs: ["current", "previous", "guess", "levels", "iterations", "window"],
	outputs: ["flow", "confidence"],
	build: (g) => {
		const current = g.input("current", "texture", { label: "Current" });
		const previous = g.input("previous", "texture", { label: "Previous" });
		const guess = g.input("guess", "texture", { label: "Guess" });
		const levels = g.input("levels", "i32", { label: "Levels", default: 4, min: 1 });
		const iterations = g.input("iterations", "i32", {
			label: "Iterations",
			default: 2,
			min: 0,
		});
		const window = g.input("window", "f32", { label: "Window", default: 2, min: 0 });

		// Level L of the mip chain is pyramid level L.
		const pyramid = (frame: Ref) =>
			g.renderTexture(
				{
					luma: {
						value: g.call(luma, {
							rgb: (() => {
								const { x, y, z } = g.separateVector(
									g.sampleTexture(frame, g.uv(), 0, CLAMP, 0).color,
								);
								return g.vec("vec3f", x, y, z);
							})(),
						}).luma,
						type: "f32",
						format: "r16float",
					},
				},
				{ like: frame, mips: true },
			).luma;
		const { currentLuma, previousLuma } = g.frame(
			"Pyramids",
			{ note: "The luma of both frames, each with its mip chain." },
			() => ({ currentLuma: pyramid(current), previousLuma: pyramid(previous) }),
		);
		// Asking for more levels than the mip chain has uses the chain's.
		const count = g.max(g.min(levels, g.textureSize(currentLuma, 0).levels), 1);
		const levelOf = (iteration: Ref) => g.sub(g.sub(count, 1), iteration);
		const scaleOf = (level: Ref) => g.pow(2, g.negate(g.toFloat(level)));

		const { flow } = g.repeatPasses(
			count,
			{
				flow: {
					type: "texture",
					initial: guess,
					format: "rgba32float",
					size: (iteration) => ({ scale: scaleOf(levelOf(iteration)), like: current }),
				},
			},
			(iteration, outer) => {
				const level = levelOf(iteration);
				const refined = g.repeatPasses(
					iterations,
					{
						flow: {
							type: "texture",
							initial: outer.flow,
							format: "rgba32float",
							size: { scale: scaleOf(level), like: current },
						},
					},
					(_, inner) => ({
						flow: g.call(lucasKanadeStep, {
							previous: previousLuma,
							current: currentLuma,
							flow: inner.flow,
							level,
							window,
						}).flow,
					}),
				);
				return { flow: refined.flow };
			},
		);
		g.output("flow", flow, "texture", { label: "Flow" });
		const { z: confidence } = g.separateVector(
			g.sampleTexture(flow, g.uv(), 0, CLAMP, 0).color,
		);
		g.output("confidence", confidence, "f32", { label: "Confidence" });
	},
});

export default [sampleCubic, lucasKanadeStep, opticalFlow];
