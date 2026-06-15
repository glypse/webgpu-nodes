import type { NodeDescriptor } from "../types";

export const floatNode = {
	type: "float",
	label: "f32",
	category: "input",
	inputs: [{ name: "value", type: "f32" }],
	outputs: [{ name: "value", type: "f32" }],
	defaultData: { value: 0.0 },
	wgsl: ({ varName, data }) => [`let ${varName} = f32(${String(data.value)});`]
} satisfies NodeDescriptor;
