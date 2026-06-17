import type { NodeDescriptor } from "../types";

export const remapNode = {
	type: "remap",
	label: "Remap",
	category: "math",
	inputs: [
		{ name: "e", type: "f32" },
		{ name: "in_min", type: "f32" },
		{ name: "in_max", type: "f32" },
		{ name: "out_min", type: "f32" },
		{ name: "out_max", type: "f32" }
	],
	outputs: [{ name: "result", type: "f32" }],
	defaultData: {},
	wgsl: ({ varName, inputs }) => {
		const e = inputs.e[0] ?? "f32(0.0)";
		const in_min = inputs.in_min[0] ?? "f32(0.0)";
		const in_max = inputs.in_max[0] ?? "f32(1.0)";
		const out_min = inputs.out_min[0] ?? "f32(0.0)";
		const out_max = inputs.out_max[0] ?? "f32(1.0)";
		return [
			`let ${varName} = ${out_min} + (${e} - ${in_min}) * safeDivF32((${out_max} - ${out_min}), (${in_max} - ${in_min}));`
		];
	}
} satisfies NodeDescriptor;
