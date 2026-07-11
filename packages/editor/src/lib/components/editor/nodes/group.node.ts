import type { HydratedGraphDocument } from "../graph-state.svelte";
import type { GroupedNode, HandleDef, NodeDescriptor } from "../types";

export function buildGroupDescriptor(
	node: GroupedNode,
	definitions: Record<string, HydratedGraphDocument>,
): NodeDescriptor {
	const definitionRef = node.group?.definitionRef;
	const definition = definitionRef ? definitions[definitionRef] : undefined;

	if (!definition || !definitionRef) {
		console.warn(
			`[graph] group node "${node.id}" references missing definition "${String(definitionRef)}"`,
		);
		return {
			type: "node-group",
			label: "⚠ Missing group",
			category: "output",
			inputs: [],
			outputs: [],
			defaultData: {},
			wgsl: () => [],
		};
	}

	const inputNode = definition.nodes.find((n) => n.type === "group-input");
	const outputNode = definition.nodes.find((n) => n.type === "group-output");

	const handles = {
		inputs: (inputNode?.data.handles ?? []) as HandleDef[],
		outputs: (outputNode?.data.handles ?? []) as HandleDef[],
	};

	return {
		type: "node-group",
		label: definitionRef, // TODO Placeholder - allow to change group label
		category: "output",
		inputs: handles.inputs.map((h) => ({ name: h.id, type: h.type })),
		outputs: handles.outputs.map((h) => ({ name: h.id, type: h.type })),
		defaultData: {},
		wgsl: () => [], // stubbed, same as group-input/output — group codegen is future work
	};
}
