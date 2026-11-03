// One-dimensional blur kernels: a weighted sum of a texture's pixels along a
// direction, which a blur runs once per axis.
import { EXTENSIONS } from "../../../../src/nodes/texture";
import { group, type GroupBuilder, helpers, type Ref } from "../../builder";

/** The edge modes of Sample Texture's extension, which blurs pass on. */
export const EDGES = EXTENSIONS.map((v) => [v.value, v.label] as const);

const KERNEL_INPUTS = ["texture", "direction", "radius", "edges"] as const;

/**
 * The inputs every kernel shares: the texture, the step from one tap to the
 * next (one pixel along an axis, in UV), the radius in pixels and the edges.
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
 * The taps `-n…n` (n = ⌈radius⌉) of a kernel weighting the tap `k` pixels
 * away by `weight(k)`, summed in premultiplied alpha (else transparent
 * pixels darken their neighbours), then normalised by the weights' sum.
 */
function weightedSum(
	g: GroupBuilder<(typeof KERNEL_INPUTS)[number], "color">,
	{ texture, direction, radius, edges }: ReturnType<typeof kernelInputs>,
	weight: (k: Ref) => Ref,
): Ref {
	const reach = g.ceil(g.max(radius, 0));
	const { sum, total } = g.frame(
		"Taps",
		{
			note: "One sample per pixel from -⌈radius⌉ to ⌈radius⌉ along the direction,\nweighted, its colour premultiplied by its alpha.",
		},
		() =>
			g.repeat(
				g.add(g.mul(reach, 2), 1),
				{ sum: ["vec4f", g.constant("vec4f", 0)], total: ["f32", 0] },
				(iteration, state) => {
					const k = g.sub(g.toFloat(iteration), reach);
					const at = g.add(g.uv(), g.mul(direction, k));
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
		// Three standard deviations reach the radius, where weights fall to about 1%.
		const twoVariance = g.frame("Spread", { note: "σ = radius / 3, as 2σ²." }, () => {
			const sigma = g.max(g.div(inputs.radius, 3), 0.0001);
			return g.mul(g.mul(sigma, sigma), 2);
		});
		const color = weightedSum(g, inputs, (k) =>
			g.exp(g.negate(g.div(g.mul(k, k), twoVariance))),
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
		// Equal weights out to the radius, the outermost taps weighted by its
		// fraction, so a radius growing smoothly blurs smoothly.
		const color = weightedSum(g, inputs, (k) =>
			g.clamp(g.sub(g.add(inputs.radius, 1), g.abs(k)), 0, 1),
		);
		g.output("color", color, "vec4f", { label: "Color" });
	},
});
