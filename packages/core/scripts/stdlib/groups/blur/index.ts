// Blurs: each runs a one-dimensional kernel horizontally, renders it to a
// texture, then runs it vertically on that, and renders the result. With a
// direction, the kernel runs once, along an angle.
import { group, type GroupBuilder, type GroupSpec, helpers, type Ref } from "../../builder";
import { boxBlur1d, EDGES, gaussianBlur1d } from "./kernel";

type Kernel = typeof gaussianBlur1d;

const BLUR_INPUTS = ["texture", "radius", "edges", "direction", "angle"] as const;
type BlurInput = (typeof BLUR_INPUTS)[number];

const MAX_ITERATIONS = 8;

function blurInputs<I extends string>(g: GroupBuilder<I | BlurInput, "texture">) {
	const texture = g.input("texture", "texture", { label: "Texture" });
	const t = g.typeVariable("t", "T", ["f32", "vec2f"]);
	const radius = g.input("radius", t, { label: "Radius", default: 0.01, min: 0 });
	const edges = g.enum("edges", EDGES, 0, { label: "Edges" });
	const direction = g.toggle("direction", 0, { label: "Direction" });
	const angle = g.input("angle", "f32", {
		label: "Angle",
		default: 0,
		owner: { enum: direction, value: 1 },
	});
	return { texture, radius, edges, direction, angle };
}

/** A blur by `kernel`: along both axes in turn, or along its angle. */
function blur(
	spec: Pick<GroupSpec, "id" | "name" | "aliases" | "section" | "searchSection">,
	kernel: Kernel,
): GroupSpec<BlurInput, "texture"> {
	return group({
		section: ["Blur"],
		...spec,
		inputs: BLUR_INPUTS,
		outputs: ["texture"],
		category: "texture",
		build: (g) => {
			const { texture, radius, edges, direction, angle } = blurInputs(g);
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
			const { x: stepX, y: stepY } = g.separateVector(g.div(1, resolution));
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
			const color = g.match(direction, { 0: vertical.color, 1: along.color });
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
	gaussianBlur1d,
);

const boxBlurOnce = blur(
	{ id: "std-box-blur-once", name: "Box Blur Once", ...helpers("Blur") },
	boxBlur1d,
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
			max: MAX_ITERATIONS,
			compiled: true,
		});
		// Rendered passes can't loop: each iteration is a blur of its own, and
		// only those the count reaches are rendered.
		const stages: Ref[] = [texture];
		for (let i = 0; i < MAX_ITERATIONS; i++) {
			const previous = stages.at(-1) ?? texture;
			stages.push(g.call(boxBlurOnce, { texture: previous, ...settings }).texture);
		}
		g.output("texture", g.indexSwitch(iterations, stages, "texture"), "texture", {
			label: "Texture",
		});
	},
});

export default [gaussianBlur1d, boxBlur1d, gaussianBlur, boxBlurOnce, boxBlur];
