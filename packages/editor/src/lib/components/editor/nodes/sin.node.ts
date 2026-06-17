import type { NodeDescriptor } from "../types";

export const sinNode = {
	type: "sin",
	label: "Sine",
	category: "math",
	inputs: [{ name: "e", type: "f32" }],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: ({ varName, inputs }) => {
		const e = inputs.e[0];
		return [`let ${varName} = sin(${e});`];
	}
} satisfies NodeDescriptor;
