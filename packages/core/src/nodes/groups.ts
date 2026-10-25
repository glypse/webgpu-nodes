import type { HydratedGraphDocument } from "../graph/document";
import type { GraphNode } from "../graph/document";
import {
	type HandleDef,
	type InputControl,
	type InputValue,
	type NodeDescriptor,
	type NodeInputDef,
	enumValue,
} from "../types";
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

/** The input a group input handle gives group nodes. */
export function groupInputDef(handle: HandleDef): NodeInputDef {
	const control: InputControl | undefined = handle.variants
		? { kind: "enum", variants: handle.variants }
		: handle.display === "swatch"
			? { kind: "color" }
			: handle.display === "wheel"
				? { kind: "wheel" }
				: undefined;
	return {
		id: handle.id,
		label: handle.label,
		types: [handle.type],
		...(control ? { control } : {}),
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

	// The group input's values are what instances hold until they're edited.
	const values: Record<string, InputValue> = {};
	for (const h of handles.inputs) {
		const stored = inputNode?.data.values?.[h.id];
		const value = h.variants ? enumValue(stored, h.variants) : stored;
		if (value !== undefined) values[h.id] = value;
	}

	return {
		type: "node-group",
		label: definition.label ?? definitionRef,
		category: "misc",
		staticOutputTypes: true,
		inputs: handles.inputs.map((h) => ({
			...groupInputDef(h),
			...(fallbacks.has(h.id) ? { fallback: true } : {}),
		})),
		outputs: handles.outputs.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: { values },
		...(definition.widget ? { widget: definition.widget } : {}),
		wgsl: () => [],
	};
}
