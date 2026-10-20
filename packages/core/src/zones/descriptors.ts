import type { HydratedGraphDocument } from "../graph/document";
import { type HandleDef, type NodeDescriptor, isWgslType } from "../types";

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
export const ZONE_NODE_TYPES: readonly string[] = [REPEAT_INPUT, REPEAT_OUTPUT];

/** Repeat Input's iteration count input. */
export const ITERATIONS_HANDLE = "iterations";
/** Repeat Input's current-iteration-index output. */
export const ITERATION_HANDLE = "iteration";
/** Virtual handle: dropping a link on it creates a new state item. */
export const NEW_ITEM_HANDLE = "__new_item__";

export const DEFAULT_ITERATIONS = 1;
export const DEFAULT_MAX_ITERATIONS = 1024;

export type MinimalNode = { id: string; type?: string; data: Record<string, unknown> };
export type MinimalEdge = { id: string; source: string; target: string };

export function isZoneNodeType(type: string | undefined): boolean {
	return type === REPEAT_INPUT || type === REPEAT_OUTPUT;
}

/** The id of the Repeat Output a Repeat Input is paired with. */
export function pairedOutputId(node: MinimalNode): string | undefined {
	const id = node.data.pairedOutput;
	return typeof id === "string" ? id : undefined;
}

/** The state items declared on a Repeat Output node (validated). */
export function zoneItems(outputNode: MinimalNode | undefined): HandleDef[] {
	const raw = outputNode?.data.items;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(item): item is HandleDef =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as HandleDef).id === "string" &&
			typeof (item as HandleDef).label === "string" &&
			isWgslType((item as HandleDef).type),
	);
}

/** The safety cap applied to a zone's iteration count. */
export function zoneMaxIterations(inputNode: MinimalNode): number {
	const raw = Number(inputNode.data.maxIterations);
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

export function buildRepeatInputDescriptor(
	node: MinimalNode,
	definitions: Map<string, HydratedGraphDocument>,
): NodeDescriptor {
	const items = zoneItems(findNode(pairedOutputId(node), definitions));
	return {
		...zoneDescriptorBase(REPEAT_INPUT, "Repeat Input"),
		defaultData: { iterations: DEFAULT_ITERATIONS, maxIterations: DEFAULT_MAX_ITERATIONS },
		inputs: [
			{ id: ITERATIONS_HANDLE, label: "Iterations", types: ["i32"] },
			...items.map((item) => ({ id: item.id, label: item.label, types: [item.type] })),
		],
		outputs: [
			{ id: ITERATION_HANDLE, label: "Iteration", type: "i32" },
			...items.map((item) => ({ id: item.id, label: item.label, type: item.type })),
		],
	};
}

export function buildRepeatOutputDescriptor(node: MinimalNode): NodeDescriptor {
	const items = zoneItems(node);
	return {
		...zoneDescriptorBase(REPEAT_OUTPUT, "Repeat Output"),
		defaultData: { items: [] },
		inputs: items.map((item) => ({ id: item.id, label: item.label, types: [item.type] })),
		outputs: items.map((item) => ({ id: item.id, label: item.label, type: item.type })),
	};
}
