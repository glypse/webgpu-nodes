import { caseHandle, WIDTH_SWITCH, WIDTH_SWITCH_VALUE, WIDTHS } from "../enums";
import { defineNode, typeComponents, WGSL_TYPES } from "../types";

const CASES = WIDTHS.map((w) => ({
	id: caseHandle(w.value),
	label: w.label,
	types: WGSL_TYPES,
	// Each case is typed apart: only the picked one types the result.
	family: caseHandle(w.value),
}));

/**
 * Pick a case by how many components a value's type has, known while
 * compiling: only that case is computed, and the result has its type, so
 * cases may differ in type (a vec2f for 2D, a vec3f for 3D…).
 */
export const widthSwitchNode = defineNode({
	type: WIDTH_SWITCH,
	label: "Width Switch",
	aliases: ["Type Switch", "Dimension Switch", "Switch by Width", "Component Count Switch"],
	category: "logic",
	inputs: [{ id: WIDTH_SWITCH_VALUE, label: "value", types: WGSL_TYPES }, ...CASES],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: {},
	resolveOutputType: (type, inputTypes) => inputTypes[caseHandle(typeComponents(type))] ?? "f32",
	wgsl: (ctx) => {
		const type = ctx.inputTypes[WIDTH_SWITCH_VALUE] ?? "f32";
		return [`let ${ctx.varName} = ${ctx.promoteInput(caseHandle(typeComponents(type)))};`];
	},
});
