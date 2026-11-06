// One-dimensional blur kernels: a weighted sum of a texture's pixels along a
// direction, which a blur runs once per axis.
import { EXTENSIONS } from "../../../../src/nodes/texture";
import { DEFAULT_MAX_ITERATIONS } from "../../../../src/zones/descriptors";
import { group, type GroupBuilder, helpers, type Ref } from "../../builder";

/** The edge modes of Sample Texture's extension, which blurs pass on. */
export const EDGES = EXTENSIONS.map((v) => [v.value, v.label] as const);

/** The most taps on either side of the centre a repeat zone's iterations can run. */
const MAX_REACH = Math.floor((DEFAULT_MAX_ITERATIONS - 1) / 2);

const KERNEL_INPUTS = ["texture", "direction", "radius", "edges"] as const;

/**
 * The inputs every kernel shares: the texture, the step from one tap to the
 * next (one pixel along the blur, in UV), the radius in pixels and the edges.
 */
function kernelInputs(g: GroupBuilder<(typeof KERNEL_INPUTS)[number], "color">) {
	return {
		texture: g.input("texture", "texture", { label: "Texture" }),
		direction: g.input("direction", "vec2f", { label: "Direction", default: { x: 0, y: 0 } }),
		radius: g.input("radius", "f32", { label: "Radius", default: 0, min: 0 }),
		edges: g.enum("edges", EDGES, 0, { label: "Edges" }),
	};
}

/**
 * The spacing of a kernel's taps, in pixels, and its radius counted in taps.
 * Taps are a pixel apart until the radius outgrows `MAX_REACH`, then spread
 * out evenly, so the kernel stays whole and changes smoothly with the radius.
 */
function tapSpacing(g: GroupBuilder<(typeof KERNEL_INPUTS)[number], "color">, radius: Ref) {
	return g.frame(
		"Spacing",
		{ note: "One pixel apart, or further once the radius needs more taps than a loop runs." },
		() => {
			const stride = g.max(g.div(radius, MAX_REACH), 1);
			return { stride, taps: g.div(g.max(radius, 0), stride) };
		},
	);
}

/**
 * The taps `-n…n` (n = ⌈taps⌉) of a kernel weighting tap `k` by `weight(k)`,
 * summed in premultiplied alpha (else transparent pixels darken their
 * neighbours), then normalised by the weights' sum.
 */
function weightedSum(
	g: GroupBuilder<(typeof KERNEL_INPUTS)[number], "color">,
	{ texture, direction, edges }: ReturnType<typeof kernelInputs>,
	{ stride, taps }: ReturnType<typeof tapSpacing>,
	weight: (k: Ref) => Ref,
): Ref {
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
					const { color } = g.sampleTexture(texture, at, 0, edges);
					const { x, y, z, w: alpha } = g.separateVector(color);
					const premultiplied = g.vec(
						"vec4f",
						g.mul(x, alpha),
						g.mul(y, alpha),
						g.mul(z, alpha),
						alpha,
					);
					const w = weight(k);
					return {
						sum: g.add(state.sum, g.mul(premultiplied, w)),
						total: g.add(state.total, w),
					};
				},
			),
	);
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

export const gaussianBlur1d = group({
	id: "std-gaussian-blur-1d",
	inputs: KERNEL_INPUTS,
	outputs: ["color"],
	name: "Gaussian Blur 1D",
	aliases: ["Gaussian Kernel", "Directional Gaussian Blur"],
	category: "texture",
	...helpers("Blur"),
	build: (g) => {
		const inputs = kernelInputs(g);
		const spacing = tapSpacing(g, inputs.radius);
		// Three standard deviations reach the radius, where weights fall to
		// about 1%. They're lowered to reach 0 one tap past it, or each tap
		// the kernel gains would show as a step where the radius varies.
		const { twoVariance, floor } = g.frame(
			"Spread",
			{ note: "σ = radius / 3, as 2σ², and the weight one tap past the radius." },
			() => {
				const sigma = g.max(g.div(spacing.taps, 3), 0.0001);
				const twoVariance = g.mul(g.mul(sigma, sigma), 2);
				const past = g.add(spacing.taps, 1);
				return {
					twoVariance,
					floor: g.exp(g.negate(g.div(g.mul(past, past), twoVariance))),
				};
			},
		);
		const color = weightedSum(g, inputs, spacing, (k) =>
			g.max(g.sub(g.exp(g.negate(g.div(g.mul(k, k), twoVariance))), floor), 0),
		);
		g.output("color", color, "vec4f", { label: "Color" });
	},
});

export const boxBlur1d = group({
	id: "std-box-blur-1d",
	inputs: KERNEL_INPUTS,
	outputs: ["color"],
	name: "Box Blur 1D",
	aliases: ["Box Kernel", "Mean Filter"],
	category: "texture",
	...helpers("Blur"),
	build: (g) => {
		const inputs = kernelInputs(g);
		const spacing = tapSpacing(g, inputs.radius);
		// Equal weights out to the radius, the outermost taps weighted by its
		// fraction, so a radius growing smoothly blurs smoothly.
		const color = weightedSum(g, inputs, spacing, (k) =>
			g.clamp(g.sub(g.add(spacing.taps, 1), g.abs(k)), 0, 1),
		);
		g.output("color", color, "vec4f", { label: "Color" });
	},
});
