import * as nodes from ".";
import type { NodeCategory, NodeData, NodeDescriptor } from "../types";
import { ZONE_NODE_TYPES } from "../zones";

/**
 * Placeholder descriptor for group nodes.
 * The actual shape is derived from the subgraph at runtime.
 */
const groupNode: NodeDescriptor = {
	type: "node-group",
	label: "Group",
	category: "misc",
	staticOutputTypes: true,
	inputs: [],
	outputs: [],
	defaultData: {},
	wgsl: () => [],
};

/**
 * The global node registry.
 * Built by hand right now; in the future this could auto-discover
 * exported descriptors from a directory, or accept addon registrations.
 */
export const nodeRegistry: Record<string, NodeDescriptor> = {
	// Input
	declare: nodes.declareNode,
	uv: nodes.uvNode,
	time: nodes.timeNode,
	delta: nodes.deltaNode,
	resolution: nodes.resolutionNode,

	// Math
	add: nodes.addNode,
	sub: nodes.subNode,
	mul: nodes.mulNode,
	div: nodes.divNode,
	mod: nodes.modNode,
	negate: nodes.negateNode,
	mix: nodes.mixNode,
	abs: nodes.absNode,
	min: nodes.minNode,
	max: nodes.maxNode,
	step: nodes.stepNode,
	clamp: nodes.clampNode,
	pow: nodes.powNode,
	remap: nodes.remapNode,
	sin: nodes.sinNode,
	cos: nodes.cosNode,
	tan: nodes.tanNode,
	atan: nodes.atanNode,
	atan2: nodes.atan2Node,
	floor: nodes.floorNode,
	ceil: nodes.ceilNode,
	fract: nodes.fractNode,
	round: nodes.roundNode,
	sign: nodes.signNode,
	sqrt: nodes.sqrtNode,

	// Vector
	dot: nodes.dotNode,
	distance: nodes.distanceNode,
	length: nodes.lengthNode,
	normalize: nodes.normalizeNode,
	cross: nodes.crossNode,
	reflect: nodes.reflectNode,
	"separate-vector": nodes.separateVectorNode,

	// Logic
	compare: nodes.compareNode,
	switch: nodes.switchNode,
	"boolean-math": nodes.booleanMathNode,
	not: nodes.notNode,
	"reduce-boolean": nodes.reduceBooleanNode,
	fallback: nodes.fallbackNode,

	// Integer
	bitwise: nodes.bitwiseNode,
	"bitwise-not": nodes.bitwiseNotNode,
	"bit-shift": nodes.bitShiftNode,

	// Converters
	"to-float": nodes.toFloatNode,
	"to-int": nodes.toIntNode,
	"to-uint": nodes.toUintNode,
	"to-bool": nodes.toBoolNode,

	// Color
	color: nodes.colorNode,

	// Misc
	reroute: nodes.rerouteNode,

	// Output
	"frag-output": nodes.outputNode,

	// Groups (placeholder - shape derived from subgraph at runtime)
	"node-group": groupNode,

	// Developer tools
	"test-invalid-wgsl": nodes.testInvalidWgslNode,
	"test-runtime-error": nodes.testRuntimeErrorNode,
};

export const DYNAMIC_NODE_TYPES = ["group-input", "group-output", ...ZONE_NODE_TYPES];

/** Helper: produce default node data for a registered type. */
export function defaultDataForType(type: string): NodeData {
	return structuredClone(nodeRegistry[type]?.defaultData ?? {});
}

/** Convenience: list all categories and their nodes for an AddNode menu. */
export function nodesByCategory(): Map<
	NodeCategory,
	{ type: string; label: string; category: NodeCategory }[]
> {
	const map = new Map<NodeCategory, { type: string; label: string; category: NodeCategory }[]>();
	for (const [type, desc] of Object.entries(nodeRegistry)) {
		if (desc.hidden) continue;
		const entry = { type, label: desc.label, category: desc.category };
		const list = map.get(desc.category) ?? [];
		list.push(entry);
		map.set(desc.category, list);
	}
	return map;
}
