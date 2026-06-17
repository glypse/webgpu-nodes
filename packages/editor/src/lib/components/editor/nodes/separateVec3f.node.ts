import type { NodeDescriptor } from "../types";

export const separateVec3fNode = {
	type: "separateVec3f",
	label: "Separate Vec3f",
	category: "vector",
	inputs: [{ name: "xyz", type: "vec3f" }],
	outputs: [
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
		{ name: "z", type: "f32" }
	],
	defaultData: { x: 0, y: 0, z: 0 },
	wgsl: ({ outputVars, inputs }) => {
		const src = inputs.xyz[0] ?? "vec3f(0.0)";
		return [
			`let ${outputVars.x} = ${src}.x;`,
			`let ${outputVars.y} = ${src}.y;`,
			`let ${outputVars.z} = ${src}.z;`
		];
	}
} satisfies NodeDescriptor;
