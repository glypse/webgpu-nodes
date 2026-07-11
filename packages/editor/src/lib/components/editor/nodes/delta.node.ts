import type { NodeDescriptor } from "../types";

export const deltaNode = {
	type: "delta",
	label: "Delta",
	category: "input",
	inputs: [],
	outputs: [{ name: "delta", type: "f32" }],
	defaultData: {},
	globals: [{ name: "delta", type: "f32", wgslRef: "motiongpuFrame.delta" }],
	wgsl: ({ varName, globalOverrides }) => {
		const ref = globalOverrides?.delta ?? "motiongpuFrame.delta";
		return [`let ${varName}: f32 = ${ref};`];
	},
} satisfies NodeDescriptor;
