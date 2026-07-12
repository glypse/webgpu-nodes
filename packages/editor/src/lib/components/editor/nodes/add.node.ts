import type { NodeDescriptor } from "../types";

export const addNode = {
	type: "add",
	label: "Add",
	category: "math",
	inputs: [{ name: "operands", label: "operands", type: "f32", variadic: true }],
	outputs: [{ name: "result", label: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const list = inputs.operands;
		// @ts-expect-error Inputs are guaranteed present by codegen
		if (list.length === 0) {
			return [`let ${varName} = f32(0.0);`];
		}
		// @ts-expect-error Inputs are guaranteed present by codegen
		return [`let ${varName} = ${list.join(" + ")};`];
	},
} satisfies NodeDescriptor;
