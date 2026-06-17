import type { NodeDescriptor } from "../types";

export const mixNode = {
	type: "mix",
	label: "Mix",
	category: "math",
	inputs: [
		{ name: "e1", type: "f32" },
		{ name: "e2", type: "f32" },
		{ name: "e3", type: "f32" }
	],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const e1 = inputs.e1[0] ?? "f32(0.0)";
		const e2 = inputs.e2[0] ?? "f32(0.0)";
		const e3 = inputs.e3[0] ?? "f32(0.0)";
		return [`let ${varName} = mix(${e1}, ${e2}, ${e3});`];
	}
} satisfies NodeDescriptor;
