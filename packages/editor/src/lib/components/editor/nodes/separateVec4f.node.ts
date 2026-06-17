import type { NodeDescriptor } from "../types";

export const separateVec4fNode = {
	type: "separateVec4f",
	label: "Separate Vec4f",
	category: "vector",
	inputs: [{ name: "xyzw", type: "vec4f" }],
	outputs: [
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
		{ name: "z", type: "f32" },
		{ name: "w", type: "f32" }
	],
	defaultData: { x: 0, y: 0, z: 0 },
	wgsl: ({ outputVars, inputs }) => {
		const src = inputs.xyzw[0] ?? "vec4f(0.0)";
		return [
			`let ${outputVars.x} = ${src}.x;`,
			`let ${outputVars.y} = ${src}.y;`,
			`let ${outputVars.z} = ${src}.z;`,
			`let ${outputVars.w} = ${src}.w;`
		];
	}
} satisfies NodeDescriptor;
