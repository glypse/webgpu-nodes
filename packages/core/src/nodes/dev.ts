import type { NodeDescriptor } from "../types";
import { FLOAT_TYPES } from "../types";

// Nodes producing shader errors on purpose, to exercise the error reporting.

export const testInvalidWgslNode: NodeDescriptor = {
	type: "test-invalid-wgsl",
	label: "⚠ Test: Bad WGSL",
	category: "misc",
	dev: true,
	inputs: [],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = this_is_not_valid_wgsl;`],
};

export const testRuntimeErrorNode: NodeDescriptor = {
	type: "test-runtime-error",
	label: "⚠ Test: Runtime Error",
	category: "misc",
	dev: true,
	inputs: [{ id: "e", label: "e", types: FLOAT_TYPES }],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("e")} / f32(0.0);`],
};
