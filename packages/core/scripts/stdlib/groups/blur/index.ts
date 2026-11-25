// Blurs: each runs a one-dimensional kernel horizontally, renders it to a
// texture, then runs it vertically on that, and renders the result. With a
// direction, the kernel runs once, along an angle; unseparated, a
// two-dimensional kernel does all of it in one go.
import { group, type GroupBuilder, type GroupSpec, helpers } from "../../builder";
import { boxBlur1d, boxBlur2d, EDGES, gaussianBlur1d, gaussianBlur2d } from "./kernel";

type Kernels = { along: typeof gaussianBlur1d; around: typeof gaussianBlur2d };

const BLUR_INPUTS = ["texture", "radius", "edges", "separable", "direction", "angle"] as const;
type BlurInput = (typeof BLUR_INPUTS)[number];

function blurInputs<I extends string>(g: GroupBuilder<I | BlurInput, "texture">) {
	const texture = g.input("texture", "texture", { label: "Texture" });
	const t = g.typeVariable("t", "T", ["f32", "vec2f"]);
	const radius = g.input("radius", t, { label: "Radius", default: 0.01, min: 0 });
	const edges = g.enum("edges", EDGES, 0, { label: "Edges" });
	const direction = g.toggle("direction", 0, { label: "Direction" });
	const separable = g.toggle("separable", 1, {
		label: "Separable",
		owner: { enum: direction, value: 0 },
	});
	const angle = g.input("angle", "f32", {
		label: "Angle",
		default: 0,
		owner: { enum: direction, value: 1 },
	});
	return { texture, radius, edges, separable, direction, angle };
}

/** A blur by `kernels`: along both axes in turn or at once, or along its angle. */
function blur(
	spec: Pick<GroupSpec, "id" | "name" | "aliases" | "section" | "searchSection">,
	{ along: kernel, around }: Kernels,
): GroupSpec<BlurInput, "texture"> {
	return group({
		section: ["Blur"],
		...spec,
		inputs: BLUR_INPUTS,
		outputs: ["texture"],
		category: "texture",
		build: (g) => {
			const { texture, radius, edges, separable, direction, angle } = blurInputs(g);
			const { pixels, resolution } = g.frame(
				"Pixels",
				{
					note: "The radius is a fraction of the canvas' height, like UV,\nso any resolution blurs alike: in pixels, per axis.",
				},
				() => {
					const resolution = g.resolution();
					const pixels = g.mul(
						g.mul(radius, g.constant("vec2f", 1)),
						g.separateVector(resolution).y,
					);
					return { pixels, resolution };
				},
			);
			const { x: pixelsX, y: pixelsY } = g.separateVector(pixels);
			const step = g.div(1, resolution);
			const { x: stepX, y: stepY } = g.separateVector(step);
			const horizontal = g.call(kernel, {
				texture,
				direction: g.vec("vec2f", stepX, 0),
				radius: pixelsX,
				edges,
			});
			// The horizontal blur's colour, linked to a Texture input, is rendered first.
			const vertical = g.call(kernel, {
				texture: horizontal.color,
				direction: g.vec("vec2f", 0, stepY),
				radius: pixelsY,
				edges,
			});
			const exact = g.call(around, { texture, step, radius: pixels, edges });
			const along = g.frame(
				"Along the angle",
				{
					note: "A pixel's step along the angle, in degrees from the x axis,\nand the radius that way: per axis radii make an ellipse.",
				},
				() => {
					const radians = g.mul(angle, Math.PI / 180);
					const unit = g.vec("vec2f", g.cos(radians), g.sin(radians));
					return g.call(kernel, {
						texture,
						direction: g.div(unit, resolution),
						radius: g.length(g.mul(pixels, unit)),
						edges,
					});
				},
			);
			const bothAxes = g.match(separable, { 0: exact.color, 1: vertical.color });
			const color = g.match(direction, { 0: bothAxes, 1: along.color });
			g.output("texture", color, "texture", { label: "Texture" });
		},
	});
}

export const gaussianBlur = blur(
	{
		id: "std-gaussian-blur",
		name: "Gaussian Blur",
		aliases: ["Blur", "Soften", "Defocus", "Gaussian"],
	},
	{ along: gaussianBlur1d, around: gaussianBlur2d },
);

const boxBlurOnce = blur(
	{ id: "std-box-blur-once", name: "Box Blur Once", ...helpers("Blur") },
	{ along: boxBlur1d, around: boxBlur2d },
);

export const boxBlur = group({
	id: "std-box-blur",
	name: "Box Blur",
	aliases: ["Blur", "Mean Blur", "Average"],
	inputs: [...BLUR_INPUTS, "iterations"],
	outputs: ["texture"],
	category: "texture",
	section: ["Blur"],
	build: (g) => {
		const { texture, ...settings } = blurInputs(g);
		const iterations = g.input("iterations", "i32", {
			label: "Iterations",
			default: 1,
			min: 1,
		});
		// A count of zero is the texture as it is.
		const { texture: blurred } = g.repeatPasses(
			iterations,
			{ texture: { type: "texture", initial: texture } },
			(_, state) => ({
				texture: g.call(boxBlurOnce, { texture: state.texture, ...settings }).texture,
			}),
		);
		g.output("texture", blurred, "texture", { label: "Texture" });
	},
});

export default [
	gaussianBlur1d,
	boxBlur1d,
	gaussianBlur2d,
	boxBlur2d,
	gaussianBlur,
	boxBlurOnce,
	boxBlur,
];
