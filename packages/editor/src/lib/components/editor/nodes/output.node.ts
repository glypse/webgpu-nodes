import type { NodeDescriptor } from "../types";

export const outputNode = {
	type: "frag-output",
	label: "Output",
	category: "output",
	inputs: [{ name: "color", label: "color", type: "vec4f" }],
	outputs: [],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const color = inputs.color[0] ?? "vec4f(0.0, 0.0, 0.0, 1.0)";
		return [`let ${varName} = ${color};`];
	},
} satisfies NodeDescriptor;
