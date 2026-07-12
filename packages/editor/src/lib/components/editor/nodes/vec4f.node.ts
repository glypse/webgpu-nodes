import type { NodeDescriptor } from "../types";

export const vec4fNode = {
	type: "vec4f",
	label: "Vec4f",
	category: "vector",
	inputs: [
		{ name: "x", label: "x", type: "f32" },
		{ name: "y", label: "y", type: "f32" },
		{ name: "z", label: "z", type: "f32" },
		{ name: "w", label: "w", type: "f32" },
	],
	outputs: [{ name: "value", label: "value", type: "vec4f" }],
	defaultData: { x: 0, y: 0, z: 0, w: 1 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const x = inputs.x[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const y = inputs.y[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const z = inputs.z[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const w = inputs.w[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = vec4f(${x}, ${y}, ${z}, ${w});`];
	},
} satisfies NodeDescriptor;
