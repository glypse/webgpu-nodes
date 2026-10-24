import type { NodeDescriptor } from "../types";
import { WGSL_TYPES } from "../types";

// ── Standalone nodes (unique patterns) ───────────────────────────────────────

/**
 * A bare handle to route links through: forwards whatever it receives,
 * keeping its type.
 */
export const rerouteNode: NodeDescriptor = {
	type: "reroute",
	label: "Reroute",
	aliases: ["Null", "Knot", "Dot", "Passthrough"],
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
	// Padding a vec3f to vec4f would give it a zero alpha: an opaque colour is
	// meant instead, so vec3f is accepted as is and gets an alpha of 1 here.
	inputs: [
		{ id: "color", label: "color", types: ["vec4f", "vec3f"], control: { kind: "color" } },
	],
	outputs: [],
	defaultData: {},
	wgsl: (ctx) => {
		const color = ctx.promoteInput("color");
		const rgba = ctx.inputTypes.color === "vec3f" ? `vec4f(${color}, 1.0)` : color;
		return [`let ${ctx.varName} = ${rgba};`];
	},
};
