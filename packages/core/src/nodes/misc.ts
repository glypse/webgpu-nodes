import { LAYOUT_FRAME } from "../frames/analysis";
import { defineNode, type NodeData, WGSL_TYPES } from "../types";

// ── Standalone nodes (unique patterns) ───────────────────────────────────────

/**
 * Whether a node is a reroute whose links out are drawn as tags (see
 * `NodeData.hideLinks`): a named value used anywhere without a link
 * across the graph.
 */
export function hidesLinks(node: { type?: string; data: NodeData } | undefined): boolean {
	return node?.type === "reroute" && node.data.hideLinks === true;
}

/**
 * A bare handle to route links through: forwards whatever it receives,
 * keeping its type.
 */
export const rerouteNode = defineNode({
	type: "reroute",
	label: "Reroute",
	aliases: ["Null", "Knot", "Dot", "Passthrough"],
	category: "misc",
	inputs: [{ id: "in", label: "in", types: WGSL_TYPES }],
	outputs: [{ id: "out", label: "out", type: "f32" }],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("in")};`],
});

/** A labelled box around other nodes; it computes nothing. */
export const layoutFrameNode = defineNode({
	type: LAYOUT_FRAME,
	label: "Frame",
	aliases: ["Comment", "Box", "Region", "Note"],
	category: "layout",
	inputs: [],
	outputs: [],
	defaultData: {},
	wgsl: () => [],
});

export const outputNode = defineNode({
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
});
