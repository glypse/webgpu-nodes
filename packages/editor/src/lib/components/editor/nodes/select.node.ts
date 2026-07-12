import type { NodeDescriptor } from "../types";

export const mixNode = {
	type: "mix",
	label: "Mix",
	category: "math",
	inputs: [
		{ name: "e1", label: "e1", type: "f32" },
		{ name: "e2", label: "e2", type: "f32" },
		{ name: "e3", label: "e3", type: "f32" },
	],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0, e3: 0 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e1 = inputs.e1[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e2 = inputs.e2[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e3 = inputs.e3[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = mix(${e1}, ${e2}, ${e3});`];
	},
} satisfies NodeDescriptor;
