import type { NodeDescriptor } from "../types";

export const separateVec4fNode = {
	type: "separateVec4f",
	label: "Separate Vec4f",
	category: "vector",
	inputs: [{ name: "xyzw", label: "xyzw", type: "vec4f" }],
	outputs: [
		{ name: "x", label: "x", type: "f32" },
		{ name: "y", label: "y", type: "f32" },
		{ name: "z", label: "z", type: "f32" },
		{ name: "w", label: "w", type: "f32" },
	],
	defaultData: { x: 0, y: 0, z: 0, w: 0 },
	wgsl: ({ outputVars, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const src = inputs.xyzw[0] ?? "vec4f(0.0)";
		return [
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.x} = ${src}.x;`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.y} = ${src}.y;`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.z} = ${src}.z;`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.w} = ${src}.w;`,
		];
	},
} satisfies NodeDescriptor;
