import type { NodeDescriptor } from "../types";

export const vec2fNode = {
	type: "vec2f",
	label: "Vec2f",
	category: "vector",
	inputs: [
		{ name: "x", label: "x", type: "f32" },
		{ name: "y", label: "y", type: "f32" },
	],
	outputs: [{ name: "value", label: "value", type: "vec2f" }],
	defaultData: { x: 0, y: 0 },
	wgsl: ({ varName, inputs }) => {
		// @ts-expect-error Inputs are guaranteed present by codegen
		const x = inputs.x[0];
		// @ts-expect-error Inputs are guaranteed present by codegen
		const y = inputs.y[0];
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		return [`let ${varName} = vec2f(${x}, ${y});`];
	},
} satisfies NodeDescriptor;
