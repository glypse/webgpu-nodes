// Blurs: each runs a one-dimensional kernel horizontally, renders it to a
// texture, then runs it vertically on that, and renders the result.
import { group, type GroupSpec } from "../../builder";
import { boxBlur1d, EDGES, gaussianBlur1d } from "./kernel";

type Kernel = typeof gaussianBlur1d;

/** A blur by `kernel`, separated into its horizontal and vertical passes. */
function blur(
	spec: Pick<GroupSpec, "id" | "name" | "aliases">,
	kernel: Kernel,
): GroupSpec<"texture" | "radius" | "edges", "texture"> {
	return group({
		...spec,
		inputs: ["texture", "radius", "edges"],
		outputs: ["texture"],
		category: "texture",
		section: ["Blur"],
		build: (g) => {
			const texture = g.input("texture", "texture", { label: "Texture" });
			const t = g.typeVariable("t", "T", ["f32", "vec2f"]);
			const radius = g.input("radius", t, { label: "Radius", default: 0.01, min: 0 });
			const edges = g.enum("edges", EDGES, 0, { label: "Edges" });
			const { pixels, step } = g.frame(
				"Pixels",
				{
					note: "The radius is a fraction of the canvas' height, like UV,\nso any resolution blurs alike: in pixels, per axis.",
				},
				() => {
					const resolution = g.resolution();
					const { x, y } = g.separateVector(
						g.mul(
							g.mul(radius, g.constant("vec2f", 1)),
							g.separateVector(resolution).y,
						),
					);
					return { pixels: { x, y }, step: g.div(1, resolution) };
				},
			);
			const { x: stepX, y: stepY } = g.separateVector(step);
			const horizontal = g.call(kernel, {
				texture,
				direction: g.vec("vec2f", stepX, 0),
				radius: pixels.x,
				edges,
			});
			// The horizontal blur's colour, linked to a Texture input, is rendered first.
			const vertical = g.call(kernel, {
				texture: horizontal.color,
				direction: g.vec("vec2f", 0, stepY),
				radius: pixels.y,
				edges,
			});
			g.output("texture", vertical.color, "texture", { label: "Texture" });
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

export const boxBlur = blur(
	{ id: "std-box-blur", name: "Box Blur", aliases: ["Blur", "Mean Blur", "Average"] },
	boxBlur1d,
);

export default [gaussianBlur1d, boxBlur1d, gaussianBlur, boxBlur];
