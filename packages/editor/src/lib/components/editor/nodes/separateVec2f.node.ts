import type { NodeDescriptor } from "../types";

export const separateVec2fNode = {
	type: "separateVec2f",
	label: "Separate Vec2f",
	category: "vector",
	inputs: [{ name: "xy", type: "vec2f" }],
	outputs: [
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" }
	],
	defaultData: { x: 0, y: 0 },
	wgsl: ({ outputVars, inputs }) => {
		const src = inputs.xy[0] ?? "vec2f(0.0)";
		return [`let ${outputVars.x} = ${src}.x;`, `let ${outputVars.y} = ${src}.y;`];
	}
} satisfies NodeDescriptor;
