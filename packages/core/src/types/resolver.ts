import type {
	NodeData,
	NodeDescriptor,
	NodeInputDef,
	NodeOutputDef,
	TypeBindings,
	TypeVariable,
	WgslType,
} from ".";
import { boundType, highestType, inputDefaultType, inputFamilyKey } from ".";
import { availableVariants } from "../enums/shape";
import type {
	GraphDocumentEdge,
	GraphNode,
	HydratedGraphDocument,
	HydratedGraphProject,
} from "../graph/document";
import {
	inferredItemFamily,
	isInferredItem,
	pairedInput,
	pairedOutputId,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	zoneItems,
} from "../zones";

// ── Types ────────────────────────────────────────────────────────────────────

export type ResolvedNodeTypes = {
	inputTypes: Record<string, WgslType>;
	outputType: WgslType;
	resolvedInputs: NodeInputDef[];
	resolvedOutputs: NodeOutputDef[];
	/** On a group node: the types its definition's variables take for it. */
	bindings?: TypeBindings;
};

type ResolveDescriptor = (node: GraphNode) => NodeDescriptor;
type GetIncomingEdges = (nodeId: string) => GraphDocumentEdge[];
type ResolveNode = (id: string) => GraphNode | undefined;

/** What resolution reads besides the node at hand, the same for every node. */
type Env = {
	resolveDescriptor: ResolveDescriptor;
	getIncomingEdges: GetIncomingEdges;
	resolveNode: ResolveNode;
	/** The project's definitions as they are now: the model replaces the map as they change. */
	definitions: () => HydratedGraphProject["definitions"];
	/** Another node's types, memoised: what a node's types are inferred from. */
	resolve: (node: GraphNode, bindings: TypeBindings) => ResolvedNodeTypes;
};

const NO_BINDINGS: TypeBindings = {};

/** A stable key for `bindings` (the empty string for none). */
export function bindingsKey(bindings: TypeBindings): string {
	return Object.entries(bindings)
		.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([id, type]) => `${id}=${type}`)
		.join(",");
}

/** Every variable's type: the bound one, or its first. */
export function completeBindings(
	variables: readonly TypeVariable[],
	bindings: TypeBindings,
): TypeBindings {
	return Object.fromEntries(variables.map((v) => [v.id, bindings[v.id] ?? v.types[0] ?? "f32"]));
}

function definitionOf(
	nodeId: string,
	definitions: HydratedGraphProject["definitions"],
): HydratedGraphDocument | undefined {
	for (const def of definitions.values()) if (def.nodesById.has(nodeId)) return def;
	return undefined;
}

// ── Pure resolution logic ─────────────────────────────────────────────────────

/**
 * Resolve the full type information for a single node instance, inside a
 * document whose type variables take `bindings` (see `TypeBindings`).
 *
 * - **Regular nodes**: 4-phase resolution (raw inference → family grouping →
 *   family assignment → output type via `resolveOutputType` or identity).
 * - **Group boundaries**: sockets sharing a type variable take its bound type.
 * - **Group nodes**: their sockets' families decide their variables' types,
 *   which then decide their outputs' (see `resolveGroupNodeTypes`).
 */
function resolveNodeTypesForNode(
	node: GraphNode,
	descriptor: NodeDescriptor,
	incoming: GraphDocumentEdge[],
	nodeData: NodeData,
	env: Env,
	bindings: TypeBindings,
): ResolvedNodeTypes {
	if (node.type === "group-input" || node.type === "group-output") {
		const def = definitionOf(node.id, env.definitions());
		const bound = completeBindings(def?.typeVariables ?? [], bindings);
		if (node.type === "group-output") {
			// The variables' families are forced to their bound types.
			const data = { ...nodeData, types: { ...nodeData.types, ...bound } };
			return resolveRegularNodeTypes(descriptor, incoming, data, env, bound);
		}
		const resolved = resolveRegularNodeTypes(descriptor, incoming, nodeData, env, bound);
		const variables = def?.typeVariables ?? [];
		const resolvedOutputs = (def?.inputs ?? []).map((h) => ({
			id: h.id,
			label: h.label,
			type: boundType(h.type, variables, bound) ?? "f32",
		}));
		return { ...resolved, resolvedOutputs };
	}
	if (node.type === REPEAT_INPUT || node.type === REPEAT_OUTPUT) {
		return resolveZoneNodeTypes(node, descriptor, incoming, nodeData, env, bindings);
	}
	const resolved = resolveRegularNodeTypes(descriptor, incoming, nodeData, env, bindings);
	return node.type === "node-group" ? resolveGroupNodeTypes(node, resolved, env) : resolved;
}

/**
 * A Repeat Input or Output: items typed by a variable take its bound type,
 * and each item's output carries its input's type. An inferred item takes
 * the type of its initial value on the Repeat Input (the type picked there
 * while it's unlinked), which the Repeat Output's sockets are forced to:
 * its next value would make the type depend on itself, through the loop.
 */
function resolveZoneNodeTypes(
	node: GraphNode,
	descriptor: NodeDescriptor,
	incoming: GraphDocumentEdge[],
	nodeData: NodeData,
	env: Env,
	bindings: TypeBindings,
): ResolvedNodeTypes {
	const doc = definitionOf(node.id, env.definitions());
	const bound = completeBindings(doc?.typeVariables ?? [], bindings);
	let types: Record<string, WgslType> = { ...nodeData.types, ...bound };
	if (node.type === REPEAT_INPUT) {
		const linked = new Set(incoming.map((e) => e.targetHandle));
		const output = doc?.nodesById.get(pairedOutputId(node) ?? "");
		const ignored = new Set(
			zoneItems(output)
				.filter((item) => isInferredItem(item) && linked.has(item.id))
				.map((item) => inferredItemFamily(item.id)),
		);
		types = Object.fromEntries(Object.entries(types).filter(([key]) => !ignored.has(key)));
	} else {
		const input = doc && pairedInput(doc.nodes, node.id);
		const paired = input && env.resolve(input, bindings);
		for (const item of zoneItems(node)) {
			const type = paired?.inputTypes[item.id];
			if (isInferredItem(item) && type) types[inferredItemFamily(item.id)] = type;
		}
	}
	const data = { ...nodeData, types };
	const resolved = resolveRegularNodeTypes(descriptor, incoming, data, env, bindings);
	const resolvedOutputs = resolved.resolvedOutputs.map((o) => ({
		...o,
		type: resolved.inputTypes[o.id] ?? o.type,
	}));
	return { ...resolved, resolvedOutputs };
}

/**
 * A group node's variables and outputs, from its resolved inputs: a variable
 * takes the type of its sockets' family (forced on the node or inferred from
 * links), or the one picked on the node when it has no input socket.
 */
function resolveGroupNodeTypes(
	node: GraphNode,
	resolved: ResolvedNodeTypes,
	env: Env,
): ResolvedNodeTypes {
	const def = node.group && env.definitions().get(node.group.definitionRef);
	if (!def) return resolved;
	const bindings: Record<string, WgslType> = {};
	for (const variable of def.typeVariables) {
		const socket = resolved.resolvedInputs.find((i) => i.family === variable.id);
		const type = socket ? resolved.inputTypes[socket.id] : node.data.types?.[variable.id];
		bindings[variable.id] =
			type && variable.types.includes(type) ? type : (variable.types[0] ?? "f32");
	}
	// An inferred output takes the type of what reaches it, on the Group
	// Output node it's linked on.
	const outputs = def.nodes.filter((n) => n.type === "group-output");
	const inferable = def.outputs.some((h) => typeof h.type === "object" && "inferred" in h.type);
	const innerType = (handleId: string): WgslType | undefined => {
		if (!inferable) return undefined;
		const output =
			outputs.find((n) =>
				def.edgesByTarget.get(n.id)?.some((e) => e.targetHandle === handleId),
			) ?? outputs[0];
		return output && env.resolve(output, bindings).inputTypes[handleId];
	};
	const resolvedOutputs = def.outputs.map((h) => ({
		id: h.id,
		label: h.label,
		type: boundType(h.type, def.typeVariables, bindings) ?? innerType(h.id) ?? "f32",
	}));
	// Enums offer the variants their types have.
	const resolvedInputs = resolved.resolvedInputs.map((input) =>
		input.control?.kind === "enum"
			? {
					...input,
					control: {
						...input.control,
						variants: availableVariants(input.control.variants, bindings),
					},
				}
			: input,
	);
	return { ...resolved, resolvedInputs, resolvedOutputs, bindings };
}

/**
 * The standard type resolution for non-boundary nodes.
 */
function resolveRegularNodeTypes(
	descriptor: NodeDescriptor,
	incoming: GraphDocumentEdge[],
	nodeData: NodeData,
	env: Env,
	bindings: TypeBindings,
): ResolvedNodeTypes {
	const nodeOverrides = nodeData.types;

	// Phase 0: user-selected output type (typeFamily nodes such as "declare")
	// decides which inputs are active, so resolve it before the inputs.
	let familyOutputType: WgslType | undefined;
	if (descriptor.typeFamily) {
		familyOutputType =
			nodeData.types?.[descriptor.typeFamily.key] ?? descriptor.typeFamily.types[0] ?? "f32";
	}
	const activeInputs =
		familyOutputType && descriptor.resolveInputs
			? descriptor.resolveInputs(familyOutputType, nodeData)
			: descriptor.inputs;

	const familyOf = new Map(activeInputs.map((i) => [i.id, inputFamilyKey(i, activeInputs)]));
	const family = (input: NodeInputDef) => familyOf.get(input.id) ?? input.id;

	// Links from outputs their source doesn't have with these bindings don't count.
	const linkedTypes = new Map<string, WgslType[]>();
	const sourceTypesOf = (inputId: string): WgslType[] => {
		let types = linkedTypes.get(inputId);
		if (!types) {
			types = incoming
				.filter((e) => e.targetHandle === inputId)
				.flatMap((e) => sourceHandleType(e, env, bindings) ?? []);
			linkedTypes.set(inputId, types);
		}
		return types;
	};

	// Phase 1: infer each input independently
	const rawInferred: Record<string, WgslType> = {};
	for (const inputDef of activeInputs) {
		const familyOverride = nodeOverrides?.[family(inputDef)];
		if (familyOverride) {
			rawInferred[inputDef.id] = familyOverride;
			continue;
		}
		const sourceTypes = inputDef.types.length === 1 ? [] : sourceTypesOf(inputDef.id);
		if (sourceTypes.length === 0) {
			rawInferred[inputDef.id] = inputDefaultType(inputDef);
			continue;
		}
		rawInferred[inputDef.id] = highestType(sourceTypes, inputDef.types);
	}

	// Phase 2: join every input of a family. Unconnected inputs only count when
	// the family is overridden, so a lone i32 source isn't widened to f32 by its
	// unconnected (default-typed) siblings.
	const familyCandidates = new Map<string, { types: readonly WgslType[]; found: WgslType[] }>();
	for (const inputDef of activeInputs) {
		const key = family(inputDef);
		const entry = familyCandidates.get(key) ?? { types: inputDef.types, found: [] };
		// A fixed type needs no source resolved: its family takes it anyway.
		const connected =
			inputDef.types.length === 1
				? incoming.some((e) => e.targetHandle === inputDef.id)
				: sourceTypesOf(inputDef.id).length > 0;
		const overridden = nodeOverrides?.[key] !== undefined;
		const inferred = rawInferred[inputDef.id];
		if (inferred && (connected || overridden)) entry.found.push(inferred);
		familyCandidates.set(key, entry);
	}
	const familyResolved = new Map<string, WgslType>();
	for (const [key, { types, found }] of familyCandidates) {
		familyResolved.set(key, highestType(found, types));
	}

	// Phase 3: all inputs in the same family get the family's resolved type
	const inputTypes: Record<string, WgslType> = {};
	for (const inputDef of activeInputs) {
		inputTypes[inputDef.id] =
			familyResolved.get(family(inputDef)) ?? inputDefaultType(inputDef);
	}

	// Phase 4: resolve output type from the primary input
	const primary = activeInputs.find((i) => i.id === descriptor.primaryInput) ?? activeInputs[0];
	const representativeType = primary
		? (inputTypes[primary.id] ?? inputDefaultType(primary))
		: (descriptor.outputs[0]?.type ?? "f32");

	const outputType =
		familyOutputType ??
		(descriptor.resolveOutputType
			? descriptor.resolveOutputType(representativeType, inputTypes)
			: representativeType);

	// Phase 5: resolve dynamic inputs and outputs. Outputs carry their concrete
	// type so downstream consumers can read per-handle types directly.
	const rawOutputs = descriptor.resolveOutputs
		? descriptor.resolveOutputs(representativeType)
		: descriptor.outputs;
	const resolvedOutputs = descriptor.staticOutputTypes
		? rawOutputs
		: rawOutputs.map((o) => ({ ...o, type: outputType }));
	const resolvedInputs =
		familyOutputType === undefined && descriptor.resolveInputs
			? descriptor.resolveInputs(outputType, nodeData)
			: activeInputs;

	return { inputTypes, outputType, resolvedInputs, resolvedOutputs };
}

/** The type carried by one output handle of a resolved node. */
function outputHandleType(resolved: ResolvedNodeTypes, handleId: string): WgslType {
	return resolved.resolvedOutputs.find((o) => o.id === handleId)?.type ?? resolved.outputType;
}

/**
 * The WGSL type produced by an edge's source handle, in a document whose
 * variables take `bindings`: undefined when the source has no such output
 * with them.
 */
function sourceHandleType(
	edge: GraphDocumentEdge,
	env: Env,
	bindings: TypeBindings,
): WgslType | undefined {
	const sourceNode = env.resolveNode(edge.source);
	if (!sourceNode) return undefined;
	const resolved = env.resolve(sourceNode, bindings);
	return resolved.resolvedOutputs.find((o) => o.id === edge.sourceHandle)?.type;
}

/**
 * The links among `edges` to sockets their nodes don't have with the types
 * `typesOf` gives them: a socket that comes and goes with types (a vector's
 * components, a node's own sockets) may exist for some instances of a
 * generic group and not others, so its links are kept but don't count.
 */
export function unavailableEdges(
	edges: readonly GraphDocumentEdge[],
	typesOf: (nodeId: string) => ResolvedNodeTypes | undefined,
): Set<string> {
	const unavailable = new Set<string>();
	for (const e of edges) {
		const source = typesOf(e.source);
		const target = typesOf(e.target);
		if (
			(source && !source.resolvedOutputs.some((o) => o.id === e.sourceHandle)) ||
			(target && !target.resolvedInputs.some((i) => i.id === e.targetHandle))
		) {
			unavailable.add(e.id);
		}
	}
	return unavailable;
}

// ── TypeResolver class ────────────────────────────────────────────────────────

/**
 * Resolves and memoises every node's types, across the project's documents.
 * A node's types only depend on what's upstream of it (its links' sources,
 * a Repeat Output's Repeat Input, a group node's definition), so a change
 * invalidates what's downstream of it.
 *
 * Nodes inside a group with type variables resolve differently for each
 * group node: every call takes the variables' `bindings` (none by default,
 * each variable then taking its first type). Results are memoised by the
 * bindings of the node's own document's variables, all of them bound.
 */
export class TypeResolver {
	/** Memoised types, by node id then the key of its document's bindings. */
	private cache = new Map<string, Map<string, ResolvedNodeTypes>>();
	/** The type variables of each node's document. */
	private variables = new Map<string, readonly TypeVariable[]>();

	private env: Env;
	constructor(
		resolveDescriptor: ResolveDescriptor,
		definitions: () => HydratedGraphProject["definitions"],
		getIncomingEdges: GetIncomingEdges,
		resolveNode: ResolveNode,
	) {
		this.env = {
			resolveDescriptor,
			definitions,
			getIncomingEdges,
			resolveNode,
			resolve: (node, bindings) =>
				this.resolveNodeTypes(node, getIncomingEdges(node.id), bindings),
		};
	}

	private key(nodeId: string, bindings: TypeBindings): string {
		let variables = this.variables.get(nodeId);
		if (!variables) {
			variables = definitionOf(nodeId, this.env.definitions())?.typeVariables ?? [];
			this.variables.set(nodeId, variables);
		}
		return variables.length === 0 ? "" : bindingsKey(completeBindings(variables, bindings));
	}

	private forget(nodeId: string) {
		this.cache.delete(nodeId);
		this.variables.delete(nodeId);
	}

	/** A node's types, linked by `incoming` (used when they aren't memoised yet). */
	resolveNodeTypes(
		node: GraphNode,
		incoming: GraphDocumentEdge[],
		bindings: TypeBindings = NO_BINDINGS,
	): ResolvedNodeTypes {
		const key = this.key(node.id, bindings);
		const cached = this.cache.get(node.id)?.get(key);
		if (cached) return cached;
		const result = this.resolveNodeTypesUncached(node, incoming, node.data, bindings);
		const byBindings = this.cache.get(node.id) ?? new Map<string, ResolvedNodeTypes>();
		byBindings.set(key, result);
		this.cache.set(node.id, byBindings);
		return result;
	}

	/**
	 * Resolve types for a node as if it held `data`, bypassing the cache:
	 * e.g. to see what its links infer without the user's type overrides.
	 */
	resolveNodeTypesUncached(
		node: GraphNode,
		incoming: GraphDocumentEdge[],
		data: NodeData,
		bindings: TypeBindings = NO_BINDINGS,
	): ResolvedNodeTypes {
		return resolveNodeTypesForNode(
			node,
			this.env.resolveDescriptor(node),
			incoming,
			data,
			this.env,
			bindings,
		);
	}

	/** The type of an edge's source handle. */
	inferHandleType(edge: GraphDocumentEdge, bindings: TypeBindings = NO_BINDINGS): WgslType {
		const source = this.env.resolveNode(edge.source);
		if (!source) return "f32";
		return outputHandleType(this.env.resolve(source, bindings), edge.sourceHandle);
	}

	/** Forget every node's types. */
	clearCache(): void {
		this.cache.clear();
		this.variables.clear();
	}

	/**
	 * Forget the types of `nodeIds` and of everything downstream of them:
	 * through links (`allEdges`), from a Repeat Input to its Repeat Output,
	 * and from a group's nodes to its group nodes.
	 *
	 * @returns The ids of the nodes forgotten.
	 */
	invalidate(nodeIds: readonly string[], allEdges: readonly GraphDocumentEdge[]): Set<string> {
		const bySource = new Map<string, GraphDocumentEdge[]>();
		for (const e of allEdges) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
		const definitions = this.env.definitions();
		const invalidated = new Set<string>();
		const groupsSeen = new Set<string>();
		const queue: string[] = [];
		const add = (id: string) => {
			if (invalidated.has(id) || !this.env.resolveNode(id)) return;
			invalidated.add(id);
			this.forget(id);
			queue.push(id);
		};
		for (const id of nodeIds) add(id);
		// Grows as it's walked: what's added is walked too.
		for (const id of queue) {
			for (const e of bySource.get(id) ?? []) add(e.target);
			const node = this.env.resolveNode(id);
			const paired = node?.type === REPEAT_INPUT ? pairedOutputId(node) : undefined;
			if (paired) add(paired);
			const ref = [...definitions].find(([, def]) => def.nodesById.has(id))?.[0];
			if (ref === undefined || groupsSeen.has(ref)) continue;
			groupsSeen.add(ref);
			for (const def of definitions.values()) {
				for (const n of def.nodes) {
					if (n.type === "node-group" && n.group?.definitionRef === ref) add(n.id);
				}
			}
		}
		return invalidated;
	}

	/** Types for all nodes of a document. */
	computeAll(
		nodes: GraphNode[],
		allEdges: GraphDocumentEdge[],
		bindings: TypeBindings = NO_BINDINGS,
	): Map<string, ResolvedNodeTypes> {
		const targetEdgeMap = new Map<string, GraphDocumentEdge[]>();
		for (const edge of allEdges) {
			const list = targetEdgeMap.get(edge.target) ?? [];
			list.push(edge);
			targetEdgeMap.set(edge.target, list);
		}

		const resolved = new Map<string, ResolvedNodeTypes>();
		for (const node of nodes) {
			const incoming = targetEdgeMap.get(node.id) ?? [];
			resolved.set(node.id, this.resolveNodeTypes(node, incoming, bindings));
		}
		return resolved;
	}
}
