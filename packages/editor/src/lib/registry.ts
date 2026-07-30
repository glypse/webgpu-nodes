import {
	absNode,
	addNode,
	clampNode,
	cosNode,
	declareNode,
	deltaNode,
	divNode,
	dotNode,
	maxNode,
	minNode,
	mulNode,
	outputNode,
	powNode,
	remapNode,
	resolutionNode,
	mixNode,
	separateVectorNode,
	sinNode,
	subNode,
	tanNode,
	timeNode,
	uvNode,
	stepNode,
	distanceNode,
	lengthNode,
	testInvalidWgslNode,
	testRuntimeErrorNode,
} from "./node-factories";
import type { NodeDescriptor, NodeCategory } from "./types";

/**
 * Placeholder descriptor for group nodes.
 * The actual shape is derived from the subgraph at runtime.
 */
const groupNode: NodeDescriptor = {
	type: "node-group",
	label: "Group",
	category: "misc",
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
	declare: declareNode,
	uv: uvNode,
	time: timeNode,
	delta: deltaNode,
	resolution: resolutionNode,

	// Math
	add: addNode,
	sub: subNode,
	mul: mulNode,
	div: divNode,
	mix: mixNode,
	abs: absNode,
	min: minNode,
	max: maxNode,
	step: stepNode,
	clamp: clampNode,
	pow: powNode,
	remap: remapNode,
	sin: sinNode,
	cos: cosNode,
	tan: tanNode,
	dot: dotNode,
	distance: distanceNode,
	length: lengthNode,

	// Vector
	"separate-vector": separateVectorNode,

	// Output
	"frag-output": outputNode,

	// Groups (placeholder - shape derived from subgraph at runtime)
	"node-group": groupNode,

	// Test nodes (for error handling UI)
	"test-invalid-wgsl": testInvalidWgslNode,
	"test-runtime-error": testRuntimeErrorNode,
};

export const DYNAMIC_NODE_TYPES = ["group-input", "group-output"];

/** Helper: produce default node data for a registered type. */
export function defaultDataForType(type: string): Record<string, unknown> {
	return { ...nodeRegistry[type]?.defaultData };
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
