import type { HydratedGraphDocument } from "../graph/document";
import { MAX_ITERATIONS, MAX_PASS_ITERATIONS } from "../graph/limits";
import { itemSizeHandles, sizeInputs } from "../passes/item-size";
import {
	boundType,
	isTexture,
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeOutputDef,
	type TypeVariable,
	WGSL_TYPES,
	type ZoneItem,
} from "../types";

//
// A zone is a pair of nodes, after Blender's geometry-nodes zones. The output
// node owns the item list (`data.items`); the input node points at its
// partner with `data.pairedOutput`. Item handle ids are shared by both nodes.
//
// A repeat zone loops within one pixel's computation:
//
//   Repeat Input  ── inputs:  iterations, initial value of every state item
//                 └─ outputs: iteration index, current value of every item
//   Repeat Output ── inputs:  next value of every item
//                 └─ outputs: final value of every item
//
// A simulation zone steps once per frame, its state kept per pixel between
// frames:
//
//   Simulation Input  ── inputs:  initial value of every state item
//                     └─ outputs: delta time, previous frame's value of every item
//   Simulation Output ── inputs:  skip, this frame's value of every item
//                     └─ outputs: this frame's value of every item
//
// A passes zone repeats passes, not a pixel's computation: it's stepped like
// a simulation, as many times as it's told within one frame, its items kept
// in textures between iterations:
//
//   Repeat Passes Input  ── inputs:  iterations, initial value of every item
//                        └─ outputs: iteration, current value of every item
//   Repeat Passes Output ── inputs:  next value of every item
//                        └─ outputs: final value of every item
//
// Which nodes are *inside* a zone is derived from the links, never stored:
// anything downstream of the zone's input is computed in it (once per
// iteration, or by the frame's step); nodes only feeding the zone are
// invariants computed outside it. See `analyzeZones`.

export const REPEAT_INPUT = "repeat-input";
export const REPEAT_OUTPUT = "repeat-output";
export const SIMULATION_INPUT = "simulation-input";
export const SIMULATION_OUTPUT = "simulation-output";
export const PASS_REPEAT_INPUT = "pass-repeat-input";
export const PASS_REPEAT_OUTPUT = "pass-repeat-output";
export const ZONE_NODE_TYPES = [
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	SIMULATION_INPUT,
	SIMULATION_OUTPUT,
	PASS_REPEAT_INPUT,
	PASS_REPEAT_OUTPUT,
] as const;

export type ZoneKind = "repeat" | "simulation" | "passes";

/** The node types bounding each kind of zone. */
export const ZONE_BOUNDARIES = {
	repeat: { input: REPEAT_INPUT, output: REPEAT_OUTPUT },
	simulation: { input: SIMULATION_INPUT, output: SIMULATION_OUTPUT },
	passes: { input: PASS_REPEAT_INPUT, output: PASS_REPEAT_OUTPUT },
} as const satisfies Record<ZoneKind, { input: string; output: string }>;

/** Repeat Input's and Repeat Passes Input's iteration count input. */
export const ITERATIONS_HANDLE = "iterations";
/** Repeat Input's and Repeat Passes Input's current-iteration-index output. */
export const ITERATION_HANDLE = "iteration";
/** Simulation Input's output: seconds since the previous frame's step, 0 when it starts. */
export const DELTA_TIME_HANDLE = "delta-time";
/** Simulation Output's input: keep the previous frame's state rather than this frame's. */
export const SKIP_HANDLE = "skip";
/** Virtual handle: dropping a link on it creates a new state item. */
export const NEW_ITEM_HANDLE = "__new_item__";
/** The handles of zone nodes that aren't state items. */
export const FIXED_ZONE_HANDLES: ReadonlySet<string> = new Set([
	ITERATIONS_HANDLE,
	ITERATION_HANDLE,
	DELTA_TIME_HANDLE,
	SKIP_HANDLE,
]);

export const DEFAULT_ITERATIONS = 1;
export const DEFAULT_MAX_ITERATIONS = 1024;

export type MinimalNode = {
	id: string;
	type?: string;
	data: NodeData;
	group?: { definitionRef: string };
};
export type MinimalEdge = { id: string; source: string; target: string };

export function isZoneNodeType(type: string | undefined): boolean {
	return zoneKindOf(type) !== undefined;
}

/** The kind of zone a node type bounds, if it's a zone node. */
export function zoneKindOf(type: string | undefined): ZoneKind | undefined {
	if (type === REPEAT_INPUT || type === REPEAT_OUTPUT) return "repeat";
	if (type === SIMULATION_INPUT || type === SIMULATION_OUTPUT) return "simulation";
	if (type === PASS_REPEAT_INPUT || type === PASS_REPEAT_OUTPUT) return "passes";
	return undefined;
}

export function isZoneInput(type: string | undefined): boolean {
	return type === REPEAT_INPUT || type === SIMULATION_INPUT || type === PASS_REPEAT_INPUT;
}

export function isZoneOutput(type: string | undefined): boolean {
	return type === REPEAT_OUTPUT || type === SIMULATION_OUTPUT || type === PASS_REPEAT_OUTPUT;
}

/** Whether a zone keeps its items in textures: a repeat zone's live in one pixel's computation. */
export function keepsTextures(kind: ZoneKind | undefined): boolean {
	return kind === "simulation" || kind === "passes";
}

/** The id of the zone output a zone input is paired with. */
export function pairedOutputId(node: MinimalNode): string | undefined {
	return isZoneInput(node.type) ? node.data.pairedOutput : undefined;
}

/** The zone input paired with the zone output `outputId`, among its document's `nodes`. */
export function pairedInput<N extends MinimalNode>(
	nodes: readonly N[],
	outputId: string,
): N | undefined {
	return nodes.find((n) => isZoneInput(n.type) && n.data.pairedOutput === outputId);
}

/** Whether a zone of `kind` can carry an item of `item`'s type. */
export function carriesItem(kind: ZoneKind | undefined, item: Pick<ZoneItem, "type">): boolean {
	return keepsTextures(kind) || !isTexture(item.type);
}

/**
 * The state items declared on a zone output node. A repeat zone has none
 * of a texture's: those a file gives it are left out.
 */
export function zoneItems(outputNode: MinimalNode | undefined): ZoneItem[] {
	const items = outputNode?.data.items ?? [];
	const kind = zoneKindOf(outputNode?.type);
	return items.every((item) => carriesItem(kind, item))
		? items
		: items.filter((item) => carriesItem(kind, item));
}

/** The safety cap applied to a zone's iteration count. */
export function zoneMaxIterations(inputNode: MinimalNode): number {
	if (inputNode.type === PASS_REPEAT_INPUT) return MAX_PASS_ITERATIONS;
	return clampIterations(inputNode.data.maxIterations ?? DEFAULT_MAX_ITERATIONS);
}

/** An iteration cap a zone can have, the nearest to `max`. */
export function clampIterations(max: number): number {
	if (!Number.isFinite(max)) return DEFAULT_MAX_ITERATIONS;
	return Math.min(MAX_ITERATIONS, Math.max(0, Math.trunc(max)));
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

export function isInferredItem(item: ZoneItem): boolean {
	return item.type === undefined;
}

/**
 * The family of an inferred item's sockets, in the `types` of both zone
 * nodes: the zone input's takes the type of the item's initial value, the
 * zone output's is forced to it.
 */
export function inferredItemFamily(itemId: string): string {
	return `inferred:${itemId}`;
}

/**
 * An item's input: a variable's items share its family, which takes the type
 * it's bound to; an inferred item's is in a family of its own. A texture
 * item's values are colours, computed per pixel like any other.
 */
function itemInput(item: ZoneItem, variables: readonly TypeVariable[]): NodeInputDef {
	const { id, label, type } = item;
	if (type === undefined) return { id, label, types: WGSL_TYPES, family: inferredItemFamily(id) };
	if (isTexture(type)) return { id, label, types: ["vec4f"] };
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

export function buildSimulationInputDescriptor(
	node: MinimalNode,
	definitions: Map<string, HydratedGraphDocument>,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	const items = zoneItems(findNode(pairedOutputId(node), definitions));
	return {
		...zoneDescriptorBase(SIMULATION_INPUT, "Simulation Input"),
		inputs: [
			...items.map((item) => itemInput(item, variables)),
			...items.flatMap((item) => sizeInputs(itemSizeHandles(item.id), item.size, item.label)),
		],
		outputs: [
			{ id: DELTA_TIME_HANDLE, label: "Delta Time", type: "f32" },
			...items.map((item) => itemOutput(item, variables)),
		],
	};
}

export function buildSimulationOutputDescriptor(
	node: MinimalNode,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	const items = zoneItems(node);
	return {
		...zoneDescriptorBase(SIMULATION_OUTPUT, "Simulation Output"),
		defaultData: { items: [], values: { [SKIP_HANDLE]: false } },
		inputs: [
			{ id: SKIP_HANDLE, label: "Skip", types: ["bool"] },
			...items.map((item) => itemInput(item, variables)),
		],
		outputs: items.map((item) => itemOutput(item, variables)),
	};
}

export function buildPassRepeatInputDescriptor(
	node: MinimalNode,
	definitions: Map<string, HydratedGraphDocument>,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	const items = zoneItems(findNode(pairedOutputId(node), definitions));
	return {
		...zoneDescriptorBase(PASS_REPEAT_INPUT, "Repeat Passes Input"),
		defaultData: { values: { [ITERATIONS_HANDLE]: DEFAULT_ITERATIONS } },
		inputs: [
			{ id: ITERATIONS_HANDLE, label: "Iterations", types: ["i32"], frame: true },
			...items.map((item) => itemInput(item, variables)),
		],
		outputs: [
			{ id: ITERATION_HANDLE, label: "Iteration", type: "i32" },
			...items.map((item) => itemOutput(item, variables)),
		],
	};
}

export function buildPassRepeatOutputDescriptor(
	node: MinimalNode,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	const items = zoneItems(node);
	return {
		...zoneDescriptorBase(PASS_REPEAT_OUTPUT, "Repeat Passes Output"),
		defaultData: { items: [] },
		inputs: [
			...items.map((item) => itemInput(item, variables)),
			// Here and not on the input, so an item can be sized by the iteration it's written in.
			...items.flatMap((item) => sizeInputs(itemSizeHandles(item.id), item.size, item.label)),
		],
		outputs: items.map((item) => itemOutput(item, variables)),
	};
}

/**
 * The boundary node holding a zone's item size inputs: a passes zone's
 * output, so sizes can read the zone's own iteration, else its input.
 */
export function sizeNodeOf<T>(kind: ZoneKind, input: T, output: T): T {
	return kind === "passes" ? output : input;
}

/** The descriptor of a zone node, of any kind. */
export function buildZoneDescriptor(
	node: MinimalNode,
	definitions: Map<string, HydratedGraphDocument>,
	variables: readonly TypeVariable[] = [],
): NodeDescriptor {
	switch (node.type) {
		case REPEAT_INPUT:
			return buildRepeatInputDescriptor(node, definitions, variables);
		case SIMULATION_INPUT:
			return buildSimulationInputDescriptor(node, definitions, variables);
		case SIMULATION_OUTPUT:
			return buildSimulationOutputDescriptor(node, variables);
		case PASS_REPEAT_INPUT:
			return buildPassRepeatInputDescriptor(node, definitions, variables);
		case PASS_REPEAT_OUTPUT:
			return buildPassRepeatOutputDescriptor(node, variables);
		default:
			return buildRepeatOutputDescriptor(node, variables);
	}
}
