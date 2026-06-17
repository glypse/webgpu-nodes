import type { NodeDescriptor } from "../types";

export const vec2fNode = {
	type: "vec2f",
	label: "Vec2f",
	category: "vector",
	inputs: [
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" }
	],
	outputs: [{ name: "value", type: "vec2f" }],
	defaultData: { x: 0, y: 0 },
	wgsl: ({ varName, inputs }) => {
		const x = inputs.x[0];
		const y = inputs.y[0];
		return [`let ${varName} = vec2f(${x}, ${y});`];
	}
} satisfies NodeDescriptor;
