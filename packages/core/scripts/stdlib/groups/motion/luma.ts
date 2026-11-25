import { group } from "../../builder";

/** Sample Texture's Clamp extension. */
export const CLAMP = 0;

export const luma = group({
	id: "std-luma",
	name: "Luma",
	aliases: ["Luminance", "Greyscale", "Grayscale", "Brightness"],
	category: "color",
	section: ["Motion"],
	inputs: ["rgb"],
	outputs: ["luma"],
	build: (g) => {
		const rgb = g.input("rgb", "vec3f", { label: "Linear RGB" });
		g.output("luma", g.dot(rgb, { x: 0.2126, y: 0.7152, z: 0.0722 }), "f32", {
			label: "Luma",
		});
	},
});
