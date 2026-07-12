import type { NodeDescriptor } from "../types";

export const remapNode = {
	type: "remap",
	label: "Remap",
	category: "math",
	inputs: [
		{ name: "e", label: "e", type: "f32" },
		{ name: "in_min", label: "in_min", type: "f32" },
		{ name: "in_max", label: "in_max", type: "f32" },
		{ name: "out_min", label: "out_min", type: "f32" },
		{ name: "out_max", label: "out_max", type: "f32" },
	],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: { e: 0, in_min: 0, in_max: 1, out_min: 0, out_max: 1 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e = inputs.e[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const in_min = inputs.in_min[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const in_max = inputs.in_max[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const out_min = inputs.out_min[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const out_max = inputs.out_max[0];
		return [
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${varName} = ${out_min} + (${e} - ${in_min}) * safeDivF32((${out_max} - ${out_min}), (${in_max} - ${in_min}));`,
		];
	},
} satisfies NodeDescriptor;
