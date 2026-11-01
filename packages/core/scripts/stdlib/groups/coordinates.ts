// Groups reshaping coordinates and ranges.
import type { GroupSpec } from "../builder";

const ASPECT_MODES = [
	[0, "Contain (Fit)"],
	[1, "Cover (Fill)"],
	[2, "Stretch"],
] as const;

const aspectUv: GroupSpec = {
	id: "std-aspect-uv",
	name: "Aspect UV",
	aliases: ["Aspect Ratio", "Aspect Correction", "Square UV"],
	category: "input",
	build: (g) => {
		const coordinates = g.input("coordinates", "vec2f", { label: "Coordinates" });
		const mode = g.enum("mode", ASPECT_MODES, 0, { label: "Mode" });
		const { aspect, wide } = g.frame(
			"Aspect ratio",
			{ note: "The canvas' width over its height, guarded against zero." },
			() => {
				const { x: width, y: height } = g.split(g.resolution());
				const aspect = g.max(g.div(width, g.max(height, 1)), 0.000001);
				return { aspect, wide: g.compare(aspect, ">=", 1) };
			},
		);
		const scale = g.frame(
			"Scale",
			{
				note: "Squares stay square: the longer side is stretched (Contain)\nor the shorter one shrunk (Cover), unless stretched to fit.",
			},
			() => {
				const shrinkY = g.vec("vec2f", 1, g.div(1, aspect));
				const stretchX = g.vec("vec2f", aspect, 1);
				return g.match(mode, {
					0: g.select(wide, shrinkY, stretchX),
					1: g.select(wide, stretchX, shrinkY),
					2: 1,
				});
			},
		);
		g.output("coordinates", g.mul(g.fallback(coordinates, g.uv()), scale), "vec2f", {
			label: "Coordinates",
		});
	},
};

const remap: GroupSpec = {
	id: "std-remap",
	name: "Remap",
	aliases: ["Map Range", "Fit", "Range", "Rescale", "Remap Value Range", "Linear"],
	category: "math",
	build: (g) => {
		const t = g.typeVariable("t", "T", ["f32", "vec2f", "vec3f", "vec4f"]);
		const value = g.input("value", t, { label: "Value", default: 0 });
		const fromMin = g.input("from-min", t, { label: "From Min", default: 0 });
		const fromMax = g.input("from-max", t, { label: "From Max", default: 1 });
		const toMin = g.input("to-min", t, { label: "To Min", default: 0 });
		const toMax = g.input("to-max", t, { label: "To Max", default: 1 });
		const ratio = g.div(g.sub(toMax, toMin), g.sub(fromMax, fromMin));
		g.output("result", g.add(toMin, g.mul(g.sub(value, fromMin), ratio)), t, {
			label: "Result",
		});
	},
};

export default [aspectUv, remap];
