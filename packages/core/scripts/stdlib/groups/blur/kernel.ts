// Blur kernels: a weighted sum of a texture's pixels, along a direction for
// the one-dimensional ones a separable blur runs once per axis, or over a
// rectangle for the two-dimensional ones.
import { EXTENSIONS } from "../../../../src/nodes/texture";
import { DEFAULT_MAX_ITERATIONS } from "../../../../src/zones/descriptors";
import {
	group,
	type GroupBuilder,
	type GroupSpec,
	helpers,
	type Operand,
	type Ref,
} from "../../builder";

/** The edge modes of Sample Texture's extension, which blurs pass on. */
export const EDGES = EXTENSIONS.map((v) => [v.value, v.label] as const);

/** The most taps on either side of the centre a repeat zone's iterations can run. */
const MAX_REACH = Math.floor((DEFAULT_MAX_ITERATIONS - 1) / 2);

/**
 * The most taps on either side of the centre, per axis, of a two-dimensional
 * kernel: their square is what each pixel reads, which a GPU must get through
 * before the browser takes it for hung.
 */
const MAX_REACH_2D = 64;

type Kernel<I extends string> = GroupBuilder<I, "color">;

/** How a kernel weighs its taps, given the radius in taps: tap `k`'s weight. */
type Profile = <I extends string>(g: Kernel<I>, taps: Ref) => (k: Ref) => Ref;

/**
 * The spacing of a kernel's taps, in pixels, and its radius counted in taps.
 * Taps are a pixel apart until the radius outgrows `reach`, then spread out
 * evenly, so the kernel stays whole and changes smoothly with the radius.
 */
function tapSpacing<I extends string>(g: Kernel<I>, radius: Operand, reach: Operand) {
	return g.frame(
		"Spacing",
		{ note: "One pixel apart, or further once the radius needs more taps than it's given." },
		() => {
			const stride = g.max(g.div(radius, reach), 1);
			return { stride, taps: g.div(g.max(radius, 0), stride) };
		},
	);
}

/** `texture`'s colour at `at`, premultiplied by its alpha, else transparent pixels darken their neighbours. */
function premultipliedTap<I extends string>(g: Kernel<I>, texture: Ref, at: Ref, edges: Ref): Ref {
	const { color } = g.sampleTexture(texture, at, 0, edges, 0);
	const { x, y, z, w: alpha } = g.separateVector(color);
	return g.vec("vec4f", g.mul(x, alpha), g.mul(y, alpha), g.mul(z, alpha), alpha);
}

/** The straight colour of a premultiplied sum of taps weighing `total`. */
function normalised<I extends string>(g: Kernel<I>, sum: Ref, total: Ref): Ref {
	return g.frame(
		"Normalised",
		{ note: "The sum over the weights' sum, its colour divided by its alpha again." },
		() => {
			const { x, y, z, w: alpha } = g.separateVector(g.div(sum, total));
			const straight = (c: Ref) => g.div(c, alpha);
			return g.vec("vec4f", straight(x), straight(y), straight(z), alpha);
		},
	);
}

// Three standard deviations reach the radius, where weights fall to about 1%.
// They're lowered to reach 0 one tap past it, or each tap the kernel gains
// would show as a step where the radius varies.
const gaussian: Profile = (g, taps) => {
	const { twoVariance, floor } = g.frame(
		"Spread",
		{ note: "σ = radius / 3, as 2σ², and the weight one tap past the radius." },
		() => {
			const sigma = g.max(g.div(taps, 3), 0.0001);
			const twoVariance = g.mul(g.mul(sigma, sigma), 2);
			const past = g.add(taps, 1);
			return { twoVariance, floor: g.exp(g.negate(g.div(g.mul(past, past), twoVariance))) };
		},
	);
	return (k) => g.max(g.sub(g.exp(g.negate(g.div(g.mul(k, k), twoVariance))), floor), 0);
};

// Equal weights out to the radius, the outermost taps weighted by its
// fraction, so a radius growing smoothly blurs smoothly.
const box: Profile = (g, taps) => (k) => g.clamp(g.sub(g.add(taps, 1), g.abs(k)), 0, 1);

const KERNEL_1D_INPUTS = ["texture", "direction", "radius", "edges"] as const;

/**
 * A kernel along `direction`, the step of one pixel in UV: `-n…n` taps
 * (n = ⌈taps⌉) `profile` weighs.
 */
function kernel1d(
	spec: Pick<GroupSpec, "id" | "name" | "aliases">,
	profile: Profile,
): GroupSpec<(typeof KERNEL_1D_INPUTS)[number], "color"> {
	return group({
		...spec,
		inputs: KERNEL_1D_INPUTS,
		outputs: ["color"],
		category: "texture",
		...helpers("Blur"),
		build: (g) => {
			const texture = g.input("texture", "texture", { label: "Texture" });
			const direction = g.input("direction", "vec2f", {
				label: "Direction",
				default: { x: 0, y: 0 },
			});
			const radius = g.input("radius", "f32", { label: "Radius", default: 0, min: 0 });
			const edges = g.enum("edges", EDGES, 0, { label: "Edges" });
			const { stride, taps } = tapSpacing(g, radius, MAX_REACH);
			const weight = profile(g, taps);
			const reach = g.ceil(taps);
			const { sum, total } = g.frame(
				"Taps",
				{
					note: "One sample per tap along the direction, weighted,\nits colour premultiplied by its alpha.",
				},
				() =>
					g.repeat(
						g.add(g.mul(reach, 2), 1),
						{ sum: ["vec4f", g.constant("vec4f", 0)], total: ["f32", 0] },
						(iteration, state) => {
							const k = g.sub(g.toFloat(iteration), reach);
							const at = g.add(g.uv(), g.mul(direction, g.mul(k, stride)));
							const w = weight(k);
							return {
								sum: g.add(
									state.sum,
									g.mul(premultipliedTap(g, texture, at, edges), w),
								),
								total: g.add(state.total, w),
							};
						},
					),
			);
			g.output("color", normalised(g, sum, total), "vec4f", { label: "Color" });
		},
	});
}

const KERNEL_2D_INPUTS = ["texture", "step", "radius", "edges"] as const;

/**
 * A kernel over the rectangle of `radius` (in pixels, per axis) around each
 * pixel: every tap read at once, so it takes that pixel's radius wherever
 * it reads, where a separable blur's second pass reads what its first
 * computed with other pixels' radii. `step` is a pixel's size in UV.
 */
function kernel2d(
	spec: Pick<GroupSpec, "id" | "name" | "aliases">,
	profile: Profile,
): GroupSpec<(typeof KERNEL_2D_INPUTS)[number], "color"> {
	return group({
		...spec,
		inputs: KERNEL_2D_INPUTS,
		outputs: ["color"],
		category: "texture",
		...helpers("Blur"),
		build: (g) => {
			const texture = g.input("texture", "texture", { label: "Texture" });
			const step = g.input("step", "vec2f", { label: "Step", default: { x: 0, y: 0 } });
			const radius = g.input("radius", "vec2f", {
				label: "Radius",
				default: { x: 0, y: 0 },
				min: 0,
			});
			const edges = g.enum("edges", EDGES, 0, { label: "Edges" });
			const { x: radiusX, y: radiusY } = g.separateVector(radius);
			const spacingX = tapSpacing(g, radiusX, MAX_REACH_2D);
			const spacingY = tapSpacing(g, radiusY, MAX_REACH_2D);
			const weightX = profile(g, spacingX.taps);
			const weightY = profile(g, spacingY.taps);
			const reachX = g.ceil(spacingX.taps);
			const reachY = g.ceil(spacingY.taps);
			const { sum, total } = g.frame(
				"Taps",
				{
					note: "A row of taps per tap along y, each weighted by its weights\nalong both axes, its colour premultiplied by its alpha.",
				},
				() =>
					g.repeat(
						g.add(g.mul(reachY, 2), 1),
						{ sum: ["vec4f", g.constant("vec4f", 0)], total: ["f32", 0] },
						(row, rows) => {
							const ky = g.sub(g.toFloat(row), reachY);
							const wy = weightY(ky);
							const offsetY = g.mul(ky, spacingY.stride);
							return g.repeat(
								g.add(g.mul(reachX, 2), 1),
								{ sum: ["vec4f", rows.sum], total: ["f32", rows.total] },
								(column, state) => {
									const kx = g.sub(g.toFloat(column), reachX);
									const offset = g.vec(
										"vec2f",
										g.mul(kx, spacingX.stride),
										offsetY,
									);
									const at = g.add(g.uv(), g.mul(step, offset));
									const w = g.mul(weightX(kx), wy);
									return {
										sum: g.add(
											state.sum,
											g.mul(premultipliedTap(g, texture, at, edges), w),
										),
										total: g.add(state.total, w),
									};
								},
							);
						},
					),
			);
			g.output("color", normalised(g, sum, total), "vec4f", { label: "Color" });
		},
	});
}

export const gaussianBlur1d = kernel1d(
	{
		id: "std-gaussian-blur-1d",
		name: "Gaussian Blur 1D",
		aliases: ["Gaussian Kernel", "Directional Gaussian Blur"],
	},
	gaussian,
);

export const boxBlur1d = kernel1d(
	{
		id: "std-box-blur-1d",
		name: "Box Blur 1D",
		aliases: ["Box Kernel", "Mean Filter"],
	},
	box,
);

export const gaussianBlur2d = kernel2d(
	{
		id: "std-gaussian-blur-2d",
		name: "Gaussian Blur 2D",
		aliases: ["Gaussian Kernel", "Exact Gaussian Blur"],
	},
	gaussian,
);

export const boxBlur2d = kernel2d(
	{
		id: "std-box-blur-2d",
		name: "Box Blur 2D",
		aliases: ["Box Kernel", "Exact Box Blur"],
	},
	box,
);
