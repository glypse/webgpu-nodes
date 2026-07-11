import type { NodeDescriptor } from "../types";

export const timeNode = {
	type: "time",
	label: "Time",
	category: "input",
	inputs: [],
	outputs: [{ name: "time", type: "f32" }],
	defaultData: {},
	globals: [{ name: "time", type: "f32", wgslRef: "motiongpuFrame.time" }],
	wgsl: ({ varName, globalOverrides }) => {
		const ref = globalOverrides?.time ?? "motiongpuFrame.time";
		return [`let ${varName}: f32 = ${ref};`];
	},
} satisfies NodeDescriptor;
