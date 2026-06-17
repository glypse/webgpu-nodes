import type { NodeDescriptor } from "../types";

export const divNode = {
	type: "div",
	label: "Divide",
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
		return [`let ${varName} = safeDivF32(${a}, ${b});`];
	}
} satisfies NodeDescriptor;
