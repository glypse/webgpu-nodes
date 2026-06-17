import type { NodeDescriptor } from "../types";

export const tanNode = {
	type: "tan",
	label: "Tangeant",
	category: "math",
	inputs: [{ name: "e", type: "f32" }],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: ({ varName, inputs }) => {
		const e = inputs.e[0];
		return [`let ${varName} = tan(${e});`];
	}
} satisfies NodeDescriptor;
