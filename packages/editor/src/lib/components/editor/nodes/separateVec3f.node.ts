import type { NodeDescriptor } from "../types";

export const separateVec3fNode = {
	type: "separateVec3f",
	label: "Separate Vec3f",
	category: "vector",
	inputs: [{ name: "xyz", label: "xyz", type: "vec3f" }],
	outputs: [
		{ name: "x", label: "x", type: "f32" },
		{ name: "y", label: "y", type: "f32" },
		{ name: "z", label: "z", type: "f32" },
	],
	defaultData: { x: 0, y: 0, z: 0 },
	wgsl: ({ outputVars, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const src = inputs.xyz[0] ?? "vec3f(0.0)";
		return [
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.x} = ${src}.x;`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.y} = ${src}.y;`,
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			`let ${outputVars.z} = ${src}.z;`,
		];
	},
} satisfies NodeDescriptor;
