import type { NodeDescriptor } from "../types";

export const powNode = {
	type: "pow",
	label: "Power",
	category: "math",
	inputs: [
		{ name: "e1", label: "e1", type: "f32" },
		{ name: "e2", label: "e2", type: "f32" },
	],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e1 = inputs.e1[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const e2 = inputs.e2[0];
		return [
			`var ${varName}: f32;`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let _e2_${varName}: f32 = ${e2};`,
			`if (_e2_${varName} == f32(0.0)) {`,
			`  ${varName} = f32(0.0);`,
			`} else {`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`  ${varName} = pow(${e1}, _e2_${varName});`,
			`}`,
		];
	},
} satisfies NodeDescriptor;
