// Pyramidal Lucas-Kanade optical flow. Flow textures are rgba32float: the
// vector in rg (UV units, y up), the confidence in b.
import { DEFAULT_MAX_ITERATIONS } from "../../../../src/zones/descriptors";
import { group, helpers, type Ref } from "../../builder";
import { CLAMP, luma } from "./luma";

/** The most taps on either side of a window's centre that a repeat zone's iterations can run. */
const MAX_REACH = Math.floor((DEFAULT_MAX_ITERATIONS - 1) / 2);

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
		// The pass is the size of every flow texture it reads, so those are read at the
		// pixel's own texel, rows down, rather than filtered 4 loads at a time.
		const pixel = (): Ref => {
			const { x: u, y: v } = g.separateVector(g.uv());
			const { x: width, y: height } = g.separateVector(g.resolution());
			return g.vec(
				"vec2i",
				g.toInt(g.floor(g.mul(u, width))),
				g.toInt(g.floor(g.mul(g.sub(1, v), height))),
			);
		};
		const texelAt = (texture: Ref, base: Ref, offset: Ref): Ref =>
			g.node("load-texel", { texture, texel: g.add(base, offset), level: 0 });

		const products = g.frame(
			"Products",
			{
				note: "The gradients of the previous frame warped by the flow so far, averaged with\nthe current frame's, and the products the window sums. The residual reads the warped\nframe by cubic interpolation. Every pass of a level is the flow's size, its texel one over that size.",
			},
			() => {
				const { uv, texel } = perPass();
				const { x: stepX, y: stepY } = g.separateVector(texel);
				const base = pixel();
				const lumaAt = (texture: Ref, at: Ref): Ref =>
					g.separateVector(g.sampleTexture(texture, at, 0, CLAMP, mip).color).x;
				// The flow `across` texels right and `down` texels down of this pixel.
				const flowAt = (across: number, down: number): Ref => {
					const { x, y } = g.separateVector(
						texelAt(flow, base, g.constant("vec2i", { x: across, y: down })),
					);
					return g.vec("vec2f", x, y);
				};
				const here = flowAt(0, 0);
				// The point `sign` steps along (dx, dy), in UV, y up.
				const along = (dx: number, dy: number, sign: 1 | -1): Ref =>
					g.add(
						uv,
						g.vec(
							"vec2f",
							dx === 0 ? 0 : g.mul(stepX, sign * dx),
							dy === 0 ? 0 : g.mul(stepY, sign * dy),
						),
					);
				// The previous frame carried to that point by the flow there.
				const warped = (dx: number, dy: number, sign: 1 | -1): Ref =>
					lumaAt(
						previous,
						g.sub(
							along(dx, dy, sign),
							flowAt(dx === 0 ? 0 : sign * dx, dy === 0 ? 0 : -sign * dy),
						),
					);
				const slope = (dx: number, dy: number) =>
					g.div(
						g.add(
							g.sub(warped(dx, dy, 1), warped(dx, dy, -1)),
							g.sub(
								lumaAt(current, along(dx, dy, 1)),
								lumaAt(current, along(dx, dy, -1)),
							),
						),
						4,
					);
				const gx = slope(1, 0);
				const gy = slope(0, 1);
				// The one value the update is the residual of, read without the flattening of bilinear reads.
				const centre = g.separateVector(
					g.call(sampleCubic, { texture: previous, uv: g.sub(uv, here), level }).color,
				).x;
				const dt = g.sub(lumaAt(current, uv), centre);
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

		// A box of `window` pixels along one axis: taps a pixel apart, the outermost weighted
		// by the radius' fraction, read at their own texels. A window past what a repeat
		// zone can run is cut to it.
		const windowMean = (sums: { a: Ref; b: Ref }, along: "x" | "y"): { a: Ref; b: Ref } => {
			const base = pixel();
			const radius = g.min(window, MAX_REACH);
			const reach = g.ceil(radius);
			const { a, b, total } = g.repeat(
				g.add(g.mul(reach, 2), 1),
				{
					a: ["vec4f", g.constant("vec4f", 0)],
					b: ["vec4f", g.constant("vec4f", 0)],
					total: ["f32", 0],
				},
				(iteration, state) => {
					const k = g.sub(g.toFloat(iteration), reach);
					const step = g.toInt(k);
					const offset =
						along === "x" ? g.vec("vec2i", step, 0) : g.vec("vec2i", 0, step);
					const weight = g.clamp(g.sub(g.add(radius, 1), g.abs(k)), 0, 1);
					return {
						a: g.add(state.a, g.mul(texelAt(sums.a, base, offset), weight)),
						b: g.add(state.b, g.mul(texelAt(sums.b, base, offset), weight)),
						total: g.add(state.total, weight),
					};
				},
			);
			return { a: g.div(a, total), b: g.div(b, total) };
		};
		const across = g.frame(
			"Window means",
			{
				note: "A box of `window` pixels at the level: along x here, along y in the solve,\nwhich reads these rows itself rather than have a pass of its own write the result.",
			},
			() => {
				const rows = windowMean(products, "x");
				return g.renderTexture(
					{
						a: { value: rows.a, format: "rgba32float" },
						b: { value: rows.b, format: "rgba32float" },
					},
					{ like: flow },
				);
			},
		);

		const solved = g.frame(
			"Solve",
			{
				note: "(Σ∇∇ᵀ) d = -Σ∇·It for the step d in pixels, y up; a window without\nthe texture to solve keeps the flow. Confidence is the smaller eigenvalue.",
			},
			() => {
				const { texel } = perPass();
				const base = pixel();
				const none = g.constant("vec2i", { x: 0, y: 0 });
				const window2d = windowMean(across, "y");
				const { x: sxx, y: sxy, z: syy } = g.separateVector(window2d.a);
				const { x: sxt, y: syt } = g.separateVector(window2d.b);
				const { x: vx, y: vy } = g.separateVector(texelAt(flow, base, none));
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
