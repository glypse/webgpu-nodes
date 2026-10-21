import type { HydratedGraphDocument } from "../graph/document";
import type { GraphNode } from "../graph/document";
import type { HandleDef, NodeDescriptor } from "../types";
import { fallbackHandleIds } from "./logic";

// ── Group descriptor builders ─────────────────────────────────────────────────

export function buildGroupInputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-input",
		label: "Group Input",
		category: "input",
		hidden: true,
		staticOutputTypes: true,
		inputs: [],
		outputs: handles.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

export function buildGroupOutputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-output",
		label: "Group Output",
		category: "misc",
		hidden: true,
		inputs: handles.map((h) => ({ id: h.id, label: h.label, types: [h.type] })),
		outputs: [],
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

export function buildGroupDescriptor(
	node: GraphNode,
	definitions: Map<string, HydratedGraphDocument>,
): NodeDescriptor {
	const definitionRef = node.group?.definitionRef;
	const definition = definitionRef ? definitions.get(definitionRef) : undefined;

	if (!definition || !definitionRef) {
		console.warn(
			`[graph] group node "${node.id}" references missing definition "${String(definitionRef)}"`,
		);
		return {
			type: "node-group",
			label: "⚠ Missing group",
			category: "misc",
			staticOutputTypes: true,
			inputs: [],
			outputs: [],
			defaultData: {},
			wgsl: () => [],
		};
	}

	const inputNode = definition.nodes.find((n) => n.type === "group-input");
	const outputNode = definition.nodes.find((n) => n.type === "group-output");
	const fallbacks = fallbackHandleIds(definition);

	const handles = {
		inputs: inputNode?.data.handles ?? [],
		outputs: outputNode?.data.handles ?? [],
	};

	return {
		type: "node-group",
		label: definition.label ?? definitionRef,
		category: "misc",
		staticOutputTypes: true,
		inputs: handles.inputs.map((h) => ({
			id: h.id,
			label: h.label,
			types: [h.type],
			...(h.options ? { options: h.options } : {}),
			...(fallbacks.has(h.id) ? { fallback: true } : {}),
		})),
		outputs: handles.outputs.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: {},
		wgsl: () => [],
	};
}
