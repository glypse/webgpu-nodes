import type { NodeDescriptor } from "../types";

export const vec3fNode = {
	type: "vec3f",
	label: "Vec3f",
	category: "vector",
	inputs: [
		{ name: "x", label: "x", type: "f32" },
		{ name: "y", label: "y", type: "f32" },
		{ name: "z", label: "z", type: "f32" },
	],
	outputs: [{ name: "value", label: "value", type: "vec3f" }],
	defaultData: { x: 0, y: 0, z: 0 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const x = inputs.x[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const y = inputs.y[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const z = inputs.z[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = vec3f(${x}, ${y}, ${z});`];
	},
} satisfies NodeDescriptor;
