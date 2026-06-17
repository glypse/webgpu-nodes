import type { NodeDescriptor } from "../types";

export const vec4fNode = {
	type: "vec4f",
	label: "Vec4f",
	category: "vector",
	inputs: [
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
		{ name: "z", type: "f32" },
		{ name: "w", type: "f32" }
	],
	outputs: [{ name: "value", type: "vec4f" }],
	defaultData: { x: 0, y: 0, z: 0, w: 1 },
	wgsl: ({ varName, inputs }) => {
		const x = inputs.x[0];
		const y = inputs.y[0];
		const z = inputs.z[0];
		const w = inputs.w[0];
		return [`let ${varName} = vec4f(${x}, ${y}, ${z}, ${w});`];
	}
} satisfies NodeDescriptor;
