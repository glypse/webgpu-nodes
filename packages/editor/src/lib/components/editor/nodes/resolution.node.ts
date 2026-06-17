import type { NodeDescriptor } from "../types";

export const resolutionNode = {
	type: "resolution",
	label: "Resolution",
	category: "input",
	inputs: [],
	outputs: [{ name: "resolution", type: "vec2f" }],
	defaultData: {},
	wgsl: ({ varName }) => [`let ${varName}: vec2f = motiongpuFrame.resolution;`]
} satisfies NodeDescriptor;
