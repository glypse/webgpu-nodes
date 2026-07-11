import type { NodeDescriptor } from "../types";

export const resolutionNode = {
	type: "resolution",
	label: "Resolution",
	category: "input",
	inputs: [],
	outputs: [{ name: "resolution", type: "vec2f" }],
	defaultData: {},
	globals: [{ name: "resolution", type: "vec2f", wgslRef: "motiongpuFrame.resolution" }],
	wgsl: ({ varName, globalOverrides }) => {
		const ref = globalOverrides?.resolution ?? "motiongpuFrame.resolution";
		return [`let ${varName}: vec2f = ${ref};`];
	},
} satisfies NodeDescriptor;
