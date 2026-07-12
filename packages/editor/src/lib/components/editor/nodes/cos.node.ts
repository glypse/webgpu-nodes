import type { NodeDescriptor } from "../types";

export const cosNode = {
	type: "cos",
	label: "Cosine",
	category: "math",
	inputs: [{ name: "e", label: "e", type: "f32" }],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e = inputs.e[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = cos(${e});`];
	},
} satisfies NodeDescriptor;
