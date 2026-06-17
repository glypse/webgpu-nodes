import type { NodeDescriptor } from "../types";

export const timeNode = {
	type: "time",
	label: "Time",
	category: "input",
	inputs: [],
	outputs: [{ name: "time", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName }) => [`let ${varName}: f32 = motiongpuFrame.time;`]
} satisfies NodeDescriptor;
