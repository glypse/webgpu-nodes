import type { NodeDescriptor } from "../types";

export const cosNode = {
	type: "cos",
	label: "Cosine",
	category: "math",
	inputs: [{ name: "e", type: "f32" }],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: ({ varName, inputs }) => {
		const e = inputs.e[0];
		return [`let ${varName} = cos(${e});`];
	}
} satisfies NodeDescriptor;
