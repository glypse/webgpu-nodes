import type { NodeDescriptor } from "../types";
import { FLOAT_TYPES, WGSL_TYPES } from "../types";

// ── Standalone nodes (unique patterns) ───────────────────────────────────────

/**
 * A bare handle to route links through: forwards whatever it receives,
 * keeping its type.
 */
export const rerouteNode: NodeDescriptor = {
	type: "reroute",
	label: "Reroute",
	category: "misc",
	inputs: [{ id: "in", label: "in", types: WGSL_TYPES }],
	outputs: [{ id: "out", label: "out", type: "f32" }],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("in")};`],
};

export const outputNode: NodeDescriptor = {
	type: "frag-output",
	label: "Output",
	category: "misc",
	hidden: true,
	inputs: [{ id: "color", label: "color", types: ["vec4f"] }],
	outputs: [],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("color")};`],
};

// ── Test nodes (for error handling UI testing) ────────────────────────────────

export const testInvalidWgslNode: NodeDescriptor = {
	type: "test-invalid-wgsl",
	label: "⚠ Test: Bad WGSL",
	category: "misc",
	inputs: [],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = this_is_not_valid_wgsl;`],
};

export const testRuntimeErrorNode: NodeDescriptor = {
	type: "test-runtime-error",
	label: "⚠ Test: Runtime Error",
	category: "misc",
	inputs: [{ id: "e", label: "e", types: FLOAT_TYPES }],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("e")} / f32(0.0);`],
};
