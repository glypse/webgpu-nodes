import type { NodeDescriptor } from "../types";

export const subNode = {
	type: "sub",
	label: "Subtract",
	category: "math",
	inputs: [
		{ name: "a", type: "f32" },
		{ name: "b", type: "f32" }
	],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const a = inputs.a[0] ?? "f32(0.0)";
		const b = inputs.b[0] ?? "f32(0.0)";
		return [`let ${varName} = ${a} - ${b};`];
	}
} satisfies NodeDescriptor;
