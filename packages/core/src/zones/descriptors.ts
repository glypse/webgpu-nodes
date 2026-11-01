import type { HydratedGraphDocument } from "../graph/document";
import {
	boundType,
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeOutputDef,
	type TypeVariable,
	type ZoneItem,
} from "../types";

//
// A repeat zone is a pair of nodes, like Blender's geometry-nodes repeat zone:
//
//   Repeat Input  ── inputs:  iterations, initial value of every state item
//                 └─ outputs: iteration index, current value of every item
//   Repeat Output ── inputs:  next value of every item
//                 └─ outputs: final value of every item
//
// The output node owns the item list (`data.items`); the input node points at
// its partner with `data.pairedOutput`. Item handle ids are shared by both
// nodes.
//
// Which nodes are *inside* a zone is derived from the links, never stored:
// anything downstream of the Repeat Input is evaluated once per iteration;
// nodes only feeding the zone are loop invariants evaluated once before the
// loop. See `analyzeZones`.

export const REPEAT_INPUT = "repeat-input";
export const REPEAT_OUTPUT = "repeat-output";
export const ZONE_NODE_TYPES = [REPEAT_INPUT, REPEAT_OUTPUT] as const;

/** Repeat Input's iteration count input. */
export const ITERATIONS_HANDLE = "iterations";
/** Repeat Input's current-iteration-index output. */
export const ITERATION_HANDLE = "iteration";
/** Virtual handle: dropping a link on it creates a new state item. */
export const NEW_ITEM_HANDLE = "__new_item__";

export const DEFAULT_ITERATIONS = 1;
export const DEFAULT_MAX_ITERATIONS = 1024;

export type MinimalNode = { id: string; type?: string; data: NodeData };
export type MinimalEdge = { id: string; source: string; target: string };

export function isZoneNodeType(type: string | undefined): boolean {
	return type === REPEAT_INPUT || type === REPEAT_OUTPUT;
}

/** The id of the Repeat Output a Repeat Input is paired with. */
export function pairedOutputId(node: MinimalNode): string | undefined {
	return node.data.pairedOutput;
}

/** The state items declared on a Repeat Output node. */
export function zoneItems(outputNode: MinimalNode | undefined): ZoneItem[] {
	return outputNode?.data.items ?? [];
}

/** The safety cap applied to a zone's iteration count. */
export function zoneMaxIterations(inputNode: MinimalNode): number {
	const raw = inputNode.data.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : DEFAULT_MAX_ITERATIONS;
}

/** Find a node by id in any document of the project. */
function findNode(
	id: string | undefined,
	definitions: Map<string, HydratedGraphDocument>,
): MinimalNode | undefined {
	if (!id) return undefined;
	for (const doc of definitions.values()) {
		const node = doc.nodesById.get(id);
		if (node) return node;
	}
	return undefined;
}

/** An item's input: a variable's items share its family, which takes the type it's bound to. */
function itemInput(item: ZoneItem, variables: readonly TypeVariable[]): NodeInputDef {
	const { id, label, type } = item;
	if (typeof type === "string") return { id, label, types: [type] };
	const variable = variables.find((v) => v.id === type.variable);
	return { id, label, types: variable?.types ?? ["f32"], family: type.variable };
}

function itemOutput(item: ZoneItem, variables: readonly TypeVariable[]): NodeOutputDef {
	return { id: item.id, label: item.label, type: boundType(item.type, variables, {}) ?? "f32" };
}

function zoneDescriptorBase(
	type: string,
	label: string,
): Omit<NodeDescriptor, "inputs" | "outputs"> {
	return {
		type,
		label,
		category: "zone",
		hidden: true,
		staticOutputTypes: true,
		defaultData: {},
		wgsl: () => {
			throw new Error("zone boundaries are emitted structurally by codegen");
		},
	};
}

/** `variables`: the type variables of the document the zone is in. */
export function buildRepeatInputDescriptor(
	node: MinimalNode,
	definitions: Map<string, HydratedGraphDocument>,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	const items = zoneItems(findNode(pairedOutputId(node), definitions));
	return {
		...zoneDescriptorBase(REPEAT_INPUT, "Repeat Input"),
		defaultData: {
			values: { [ITERATIONS_HANDLE]: DEFAULT_ITERATIONS },
			maxIterations: DEFAULT_MAX_ITERATIONS,
		},
		inputs: [
			{ id: ITERATIONS_HANDLE, label: "Iterations", types: ["i32"] },
			...items.map((item) => itemInput(item, variables)),
		],
		outputs: [
			{ id: ITERATION_HANDLE, label: "Iteration", type: "i32" },
			...items.map((item) => itemOutput(item, variables)),
		],
	};
}

export function buildRepeatOutputDescriptor(
	node: MinimalNode,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	const items = zoneItems(node);
	return {
		...zoneDescriptorBase(REPEAT_OUTPUT, "Repeat Output"),
		defaultData: { items: [] },
		inputs: items.map((item) => itemInput(item, variables)),
		outputs: items.map((item) => itemOutput(item, variables)),
	};
}
