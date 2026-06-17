import type { NodeDescriptor } from "../types";

export const vec3fNode = {
	type: "vec3f",
	label: "Vec3f",
	category: "vector",
	inputs: [
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
		{ name: "z", type: "f32" }
	],
	outputs: [{ name: "value", type: "vec3f" }],
	defaultData: { x: 0, y: 0, z: 0 },
	wgsl: ({ varName, inputs }) => {
		const x = inputs.x[0] ?? "f32(0.0)";
		const y = inputs.y[0] ?? "f32(0.0)";
		const z = inputs.z[0] ?? "f32(0.0)";
		return [`let ${varName} = vec3f(${x}, ${y}, ${z});`];
	}
} satisfies NodeDescriptor;
