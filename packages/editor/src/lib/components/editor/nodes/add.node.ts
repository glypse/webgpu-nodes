import type { NodeDescriptor } from "../types";

export const addNode = {
	type: "add",
	label: "Add",
	category: "math",
	inputs: [{ name: "operands", type: "f32", variadic: true }],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const list = inputs.operands;
		if (list.length === 0) {
			return [`let ${varName} = f32(0.0);`];
		}
		return [`let ${varName} = ${list.join(" + ")};`];
	}
} satisfies NodeDescriptor;
