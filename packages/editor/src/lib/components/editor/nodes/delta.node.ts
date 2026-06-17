import type { NodeDescriptor } from "../types";

export const deltaNode = {
	type: "delta",
	label: "Delta",
	category: "input",
	inputs: [],
	outputs: [{ name: "delta", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName }) => [`let ${varName}: f32 = motiongpuFrame.delta;`]
} satisfies NodeDescriptor;
