import type { NodeDescriptor, WgslType } from "../types";

const COLOR_TYPES: readonly WgslType[] = ["vec3f", "vec4f"];

/**
 * A colour picked with a colour picker. Declare builds the same vectors, but
 * from numbers: this one is edited as a colour.
 */
export const colorNode: NodeDescriptor = {
	type: "color",
	label: "Color",
	aliases: ["RGB", "RGBA", "Color Constant", "Constant Color", "Solid Color", "Swatch"],
	category: "color",
	inputs: [{ id: "color", label: "color", types: ["vec3f"], control: { kind: "color" } }],
	outputs: [{ id: "color", label: "color", type: "vec3f" }],
	defaultData: { values: { color: { x: 0.8, y: 0.8, z: 0.8, w: 1 } } },
	typeFamily: { key: "color", types: COLOR_TYPES },
	resolveInputs: (resolvedOutputType) => [
		{ id: "color", label: "color", types: [resolvedOutputType], control: { kind: "color" } },
	],
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("color")};`],
};
