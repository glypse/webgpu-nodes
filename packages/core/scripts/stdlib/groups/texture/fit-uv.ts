import { group, type Ref } from "../../builder";

const FIT_MODES = [
	[0, "Contain (Fit)"],
	[1, "Cover (Fill)"],
	[2, "Stretch"],
] as const;

/** Coordinates showing a texture over the canvas at its own aspect ratio. */
export const fitUv = group({
	id: "std-fit-uv",
	inputs: ["texture", "coordinates", "mode"],
	outputs: ["coordinates"],
	name: "Fit UV",
	aliases: ["Fit Image", "Image Aspect", "Contain", "Cover", "Letterbox", "Object Fit"],
	category: "texture",
	build: (g) => {
		const texture = g.input("texture", "texture", { label: "Texture" });
		const coordinates = g.input("coordinates", "vec2f", { label: "Coordinates" });
		const mode = g.enum("mode", FIT_MODES, 0, { label: "Mode" });
		const ratio = g.frame(
			"Aspect ratios",
			{ note: "The canvas' width over its height, over the texture's." },
			() => {
				const aspect = (size: Ref) => {
					const { x: width, y: height } = g.separateVector(size);
					return g.div(width, g.max(height, 1));
				};
				return g.div(aspect(g.resolution()), aspect(g.textureSize(texture, 0).size));
			},
		);
		const scale = g.frame(
			"Scale",
			{
				note: "Around the centre, the texture's longer side fits the canvas (Contain,\nleaving bands of its edges around it) or its shorter one does (Cover,\ncropping it), unless it's stretched to fit.",
			},
			() => {
				const inverse = g.div(1, ratio);
				return g.match(mode, {
					0: g.vec("vec2f", g.max(ratio, 1), g.max(inverse, 1)),
					1: g.vec("vec2f", g.min(ratio, 1), g.min(inverse, 1)),
					2: 1,
				});
			},
		);
		const centred = g.sub(g.fallback(coordinates, g.uv()), 0.5);
		g.output("coordinates", g.add(g.mul(centred, scale), 0.5), "vec2f", {
			label: "Coordinates",
		});
	},
});

export default [fitUv];
