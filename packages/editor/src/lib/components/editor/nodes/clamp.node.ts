import type { NodeDescriptor } from "../types";

export const clampNode = {
	type: "clamp",
	label: "Clamp",
	category: "math",
	inputs: [
		{ name: "e", type: "f32" },
		{ name: "low", type: "f32" },
		{ name: "high", type: "f32" }
	],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const e = inputs.e[0] ?? "f32(0.0)";
		const low = inputs.low[0] ?? "f32(0.0)";
		const high = inputs.high[0] ?? "f32(0.0)";
		return [`let ${varName} = clamp(${e}, ${low}, ${high});`];
	}
} satisfies NodeDescriptor;
