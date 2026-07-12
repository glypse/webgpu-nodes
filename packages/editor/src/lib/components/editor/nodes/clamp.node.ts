import type { NodeDescriptor } from "../types";

export const clampNode = {
	type: "clamp",
	label: "Clamp",
	category: "math",
	inputs: [
		{ name: "e", label: "e", type: "f32" },
		{ name: "low", label: "low", type: "f32" },
		{ name: "high", label: "high", type: "f32" },
	],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: { e: 0, low: 0, high: 1 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e = inputs.e[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const low = inputs.low[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const high = inputs.high[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = clamp(${e}, ${low}, ${high});`];
	},
} satisfies NodeDescriptor;
