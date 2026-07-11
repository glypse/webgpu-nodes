import type { NodeDescriptor } from "../types";

export const uvNode = {
	type: "uv",
	label: "UV",
	category: "input",
	inputs: [],
	outputs: [{ name: "uv", type: "vec2f" }],
	defaultData: {},
	globals: [{ name: "uv", type: "vec2f", wgslRef: "uv" }],
	wgsl: ({ varName, globalOverrides }) => {
		const ref = globalOverrides?.uv ?? "uv";
		return [`let ${varName} = ${ref};`];
	},
} satisfies NodeDescriptor;
