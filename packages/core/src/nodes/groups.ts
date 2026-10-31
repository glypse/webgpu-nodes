import type { HydratedGraphDocument } from "../graph/document";
import type { GraphNode } from "../graph/document";
import {
	type GroupHandleDef,
	type InputControl,
	type InputValue,
	type NodeDescriptor,
	type NodeInputDef,
	type TypeVariable,
	WGSL_TYPES,
	type WgslType,
	boundType,
	enumValue,
} from "../types";
import { fallbackHandleIds } from "./logic";

// ── Group descriptor builders ─────────────────────────────────────────────────

/**
 * The types a socket accepts and the family it's in: a variable's sockets
 * share one, an inferred output has its own. Resolving picks the type.
 */
function socketTypes(
	handle: GroupHandleDef,
	variables: readonly TypeVariable[],
): Pick<NodeInputDef, "types" | "family"> {
	const type = handle.type;
	if (typeof type === "string") return { types: [type] };
	if ("inferred" in type) return { types: WGSL_TYPES, family: `inferred:${handle.id}` };
	const variable = variables.find((v) => v.id === type.variable);
	return { types: variable?.types ?? ["f32"], family: type.variable };
}

/** The type a socket has where nothing decides it: a variable's first type. */
function defaultType(handle: GroupHandleDef, variables: readonly TypeVariable[]): WgslType {
	return boundType(handle.type, variables, {}) ?? "f32";
}

export function buildGroupInputDescriptor(
	handles: GroupHandleDef[],
	variables: readonly TypeVariable[],
): NodeDescriptor {
	return {
		type: "group-input",
		label: "Group Input",
		category: "input",
		hidden: true,
		staticOutputTypes: true,
		inputs: [],
		outputs: handles.map((h) => ({
			id: h.id,
			label: h.label,
			type: defaultType(h, variables),
		})),
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

export function buildGroupOutputDescriptor(
	handles: GroupHandleDef[],
	variables: readonly TypeVariable[],
): NodeDescriptor {
	return {
		type: "group-output",
		label: "Group Output",
		category: "misc",
		hidden: true,
		inputs: handles.map((h) => ({ id: h.id, label: h.label, ...socketTypes(h, variables) })),
		outputs: [],
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

/** The input a group input handle gives group nodes. */
export function groupInputDef(
	handle: GroupHandleDef,
	variables: readonly TypeVariable[],
): NodeInputDef {
	const control: InputControl | undefined = handle.variants
		? { kind: "enum", variants: handle.variants }
		: handle.display === "swatch"
			? { kind: "color" }
			: handle.display === "wheel"
				? { kind: "wheel" }
				: handle.min !== undefined || handle.max !== undefined
					? {
							kind: "number",
							...(handle.min === undefined ? {} : { min: handle.min }),
							...(handle.max === undefined ? {} : { max: handle.max }),
						}
					: undefined;
	return {
		id: handle.id,
		label: handle.label,
		...socketTypes(handle, variables),
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
	const fallbacks = fallbackHandleIds(definition, definitions);

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
			...groupInputDef(h, definition.typeVariables),
			...(fallbacks.has(h.id) ? { fallback: true } : {}),
		})),
		outputs: handles.outputs.map((h) => ({
			id: h.id,
			label: h.label,
			type: defaultType(h, definition.typeVariables),
		})),
		defaultData: { values },
		...(definition.widget ? { widget: definition.widget } : {}),
		wgsl: () => [],
	};
}
