import type { NodeDescriptor, NodeCategory } from "./types";

import { floatNode } from "./nodes/float.node";
import { addNode } from "./nodes/add.node";
import { vec4fNode } from "./nodes/vec4f.node";
import { outputNode } from "./nodes/output.node";
import { uvNode } from "./nodes/uv.node";
import { separateVec2fNode } from "./nodes/separateVec2f.node";
import { subNode } from "./nodes/sub.node";
import { mulNode } from "./nodes/mul.node";
import { divNode } from "./nodes/div.node";
import { mixNode } from "./nodes/select.node";
import { absNode } from "./nodes/abs.node";
import { minNode } from "./nodes/min.node";
import { maxNode } from "./nodes/max.node";
import { clampNode } from "./nodes/clamp.node";
import { powNode } from "./nodes/pow.node";
import { remapNode } from "./nodes/remap.node";
import { vec2fNode } from "./nodes/vec2f.node";
import { vec3fNode } from "./nodes/vec3f.node";

/**
 * The global node registry.
 * Built by hand right now; in the future this could auto-discover
 * exported descriptors from a directory, or accept addon registrations.
 */
export const nodeRegistry: Record<string, NodeDescriptor> = {
	float: floatNode,
	add: addNode,
	vec4f: vec4fNode,
	output: outputNode,
	uv: uvNode,
	separateVec2f: separateVec2fNode,
	sub: subNode,
	mul: mulNode,
	div: divNode,
	mix: mixNode,
	abs: absNode,
	min: minNode,
	max: maxNode,
	clamp: clampNode,
	pow: powNode,
	remap: remapNode,
	vec2f: vec2fNode,
	vec3f: vec3fNode
};

/** Helper: produce default node data for a registered type. */
export function defaultDataForType(type: string): Record<string, unknown> {
	return { ...nodeRegistry[type].defaultData };
}

/** Convenience: list all categories and their nodes for an AddNode menu. */
export function nodesByCategory(): Map<
	NodeCategory,
	{ type: string; label: string; category: NodeCategory }[]
> {
	const map = new Map<NodeCategory, { type: string; label: string; category: NodeCategory }[]>();
	for (const [type, desc] of Object.entries(nodeRegistry)) {
		const entry = { type, label: desc.label, category: desc.category };
		const list = map.get(desc.category) ?? [];
		list.push(entry);
		map.set(desc.category, list);
	}
	return map;
}

/** Resolve input definitions from a descriptor. */
export function inputDefs(type: string): NodeDescriptor["inputs"] {
	return nodeRegistry[type].inputs;
}

/** Resolve output definitions from a descriptor. */
export function outputDefs(type: string): NodeDescriptor["outputs"] {
	return nodeRegistry[type].outputs;
}
