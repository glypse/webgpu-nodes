import type { NodeDescriptor } from "../types";

export const maxNode = {
	type: "max",
	label: "Maximum",
	category: "math",
	inputs: [
		{ name: "e1", type: "f32" },
		{ name: "e2", type: "f32" }
	],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0 },
	wgsl: ({ varName, inputs }) => {
		const e1 = inputs.e1[0];
		const e2 = inputs.e2[0];
		return [`let ${varName} = max(${e1}, ${e2});`];
	}
} satisfies NodeDescriptor;
