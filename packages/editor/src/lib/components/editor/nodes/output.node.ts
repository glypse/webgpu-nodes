import type { NodeDescriptor } from "../types";

export const outputNode = {
	type: "output",
	label: "Output",
	category: "output",
	inputs: [{ name: "color", type: "vec4f" }],
	outputs: [],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const color = inputs.color[0] ?? "vec4f(0.0, 0.0, 0.0, 1.0)";
		return [`let ${varName} = ${color};`];
	}
} satisfies NodeDescriptor;
