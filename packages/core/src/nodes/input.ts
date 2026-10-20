import type { NodeDescriptor } from "../types";
import { WGSL_TYPES, makeType, typeComponents, typeKind, wgslTypeName } from "../types";
import { uniformReader } from "./builders";

const DECLARE_COMPONENTS = ["x", "y", "z", "w"];

export const declareNode: NodeDescriptor = {
	type: "declare",
	label: "Declare",
	category: "input",
	inputs: DECLARE_COMPONENTS.map((c) => ({ id: c, label: c, types: ["f32"] as const })),
	outputs: [{ id: "value", label: "value", type: "f32" }],
	defaultData: Object.fromEntries(DECLARE_COMPONENTS.map((c) => [c, 0])),
	typeFamily: { key: "declare", types: WGSL_TYPES },
	resolveInputs: (resolvedOutputType) => {
		const scalar = makeType(typeKind(resolvedOutputType), 1);
		return DECLARE_COMPONENTS.slice(0, typeComponents(resolvedOutputType)).map((c) => ({
			id: c,
			label: c,
			types: [scalar],
		}));
	},
	wgsl: (ctx) => {
		const args = ctx.resolvedInputs.map((i) => ctx.promoteInput(i.id)).join(", ");
		if (typeComponents(ctx.outputType) === 1) return [`let ${ctx.varName} = ${args};`];
		return [`let ${ctx.varName} = ${wgslTypeName(ctx.outputType)}(${args});`];
	},
};

// Input — uniforms
export const timeNode = uniformReader("time", "Time", "time", "f32", "spektralFrame.time");
export const deltaNode = uniformReader("delta", "Delta", "delta", "f32", "spektralFrame.delta");
export const resolutionNode = uniformReader(
	"resolution",
	"Resolution",
	"resolution",
	"vec2f",
	"spektralFrame.resolution",
);
// Spektral's per-fragment context, readable from any function (unlike frag()'s
// own `uv` parameter), so UV nodes also work inside groups.
export const uvNode = uniformReader("uv", "UV", "uv", "vec2f", "spektralFragment.uv");
