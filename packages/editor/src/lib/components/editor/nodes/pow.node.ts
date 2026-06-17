import type { NodeDescriptor } from "../types";

export const powNode = {
	type: "pow",
	label: "Power",
	category: "math",
	inputs: [
		{ name: "e1", type: "f32" },
		{ name: "e2", type: "f32" }
	],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const e1 = inputs.e1[0] ?? "f32(0.0)";
		const e2 = inputs.e2[0] ?? "f32(0.0)";
		return [
			`var ${varName}: f32;`,
			`let _e2_${varName}: f32 = ${e2};`,
			`if (_e2_${varName} == f32(0.0)) {`,
			`  ${varName} = f32(0.0);`,
			`} else {`,
			`  ${varName} = pow(${e1}, _e2_${varName});`,
			`}`
		];
	}
} satisfies NodeDescriptor;
