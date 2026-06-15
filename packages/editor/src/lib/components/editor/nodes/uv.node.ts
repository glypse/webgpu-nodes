import type { NodeDescriptor } from "../types";

export const uvNode = {
	type: "uv",
	label: "UV",
	category: "input",
	inputs: [],
	outputs: [{ name: "uv", type: "vec2f" }],
	defaultData: {},
	wgsl: ({ varName }) => [`let ${varName} = uv;`]
} satisfies NodeDescriptor;
