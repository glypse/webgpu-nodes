import type { NodeDescriptor } from "../types";

export const subNode = {
	type: "sub",
	label: "Subtract",
	category: "math",
	inputs: [
		{ name: "a", label: "a", type: "f32" },
		{ name: "b", label: "b", type: "f32" },
	],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: { a: 0, b: 0 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const a = inputs.a[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const b = inputs.b[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = ${a} - ${b};`];
	},
} satisfies NodeDescriptor;
