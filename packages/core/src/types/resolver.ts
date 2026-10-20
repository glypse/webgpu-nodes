import type { NodeDescriptor, NodeInputDef, NodeOutputDef, WgslType } from ".";
import { highestType, inputDefaultType, inputFamilyKey, isWgslType } from ".";
import type { GraphDocumentEdge, HydratedGraphProject } from "../graph/document";
import type { GraphNode } from "../graph/document";

// ── Types ────────────────────────────────────────────────────────────────────

export type ResolvedNodeTypes = {
	inputTypes: Record<string, WgslType>;
	outputType: WgslType;
	resolvedInputs: NodeInputDef[];
	resolvedOutputs: NodeOutputDef[];
};

type ResolveDescriptor = (node: GraphNode) => NodeDescriptor;
type GetIncomingEdges = (nodeId: string) => GraphDocumentEdge[];

// ── Pure resolution logic ─────────────────────────────────────────────────────

/**
 * Resolve the full type information for a single node instance.
 *
 * - **Regular nodes**: 4-phase resolution (raw inference → family grouping →
 *   family assignment → output type via `resolveOutputType` or identity).
 * - **Group-output nodes**: output type is the resolved type of the
 *   group-output node *inside* the definition (cross-document resolution).
 *   Propagation stops here — ancestors within the definition are not touched.
 */
function resolveNodeTypesForNode(
	node: GraphNode,
	descriptor: NodeDescriptor,
	incoming: GraphDocumentEdge[],
	nodeData: Record<string, unknown>,
	resolveNode: (id: string) => GraphNode | undefined,
	resolveDescriptor: ResolveDescriptor,
	getIncomingEdges: GetIncomingEdges,
	definitions: HydratedGraphProject["definitions"],
): ResolvedNodeTypes {
	// Group-output boundary: resolve the internal group-output node's type.
	if (node.type === "group-output") {
		return resolveGroupOutputNodeTypes(
			node,
			resolveNode,
			resolveDescriptor,
			getIncomingEdges,
			definitions,
		);
	}

	// Regular 4-phase resolution
	return resolveRegularNodeTypes(
		descriptor,
		incoming,
		nodeData,
		resolveNode,
		resolveDescriptor,
		getIncomingEdges,
		definitions,
	);
}

/**
 * Resolve types for a group-output node by looking into its definition and
 * computing the type of the *internal* group-output node. This is the
 * cross-document resolution path.
 */
function resolveGroupOutputNodeTypes(
	node: GraphNode,
	resolveNode: (id: string) => GraphNode | undefined,
	resolveDescriptor: ResolveDescriptor,
	getIncomingEdges: GetIncomingEdges,
	definitions: HydratedGraphProject["definitions"],
): ResolvedNodeTypes {
	for (const def of definitions.values()) {
		const goNode = def.nodesById.get(node.id);
		if (goNode?.type === "group-output") {
			const incoming = def.edgesByTarget.get(node.id) ?? [];
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- GraphDocumentNode lacks Node properties required by GraphNode
			const goDescriptor = resolveDescriptor(goNode as GraphNode);
			return resolveRegularNodeTypes(
				goDescriptor,
				incoming,
				goNode.data,
				(id) => def.nodesById.get(id),
				resolveDescriptor,
				getIncomingEdges,
				definitions,
			);
		}
	}

	// Fallback: no definition found — resolve from the node's own descriptor
	const inputTypes: Record<string, WgslType> = {};
	const fallbackDescriptor = resolveDescriptor(node);
	for (const inputDef of fallbackDescriptor.inputs) {
		inputTypes[inputDef.id] = inputDefaultType(inputDef);
	}
	return {
		inputTypes,
		outputType: "f32",
		resolvedInputs: fallbackDescriptor.inputs,
		resolvedOutputs: fallbackDescriptor.outputs,
	};
}

/**
 * The standard type resolution for non-boundary nodes.
 */
function resolveRegularNodeTypes(
	descriptor: NodeDescriptor,
	incoming: GraphDocumentEdge[],
	nodeData: Record<string, unknown>,
	resolveNode: (id: string) => GraphNode | undefined,
	resolveDescriptor: ResolveDescriptor,
	getIncomingEdges: GetIncomingEdges,
	definitions: HydratedGraphProject["definitions"],
): ResolvedNodeTypes {
	const nodeOverrides = nodeData.__nodeTypeOverrides as Record<string, WgslType> | undefined;

	// Phase 0: user-selected output type (typeFamily nodes such as "declare")
	// decides which inputs are active, so resolve it before the inputs.
	let familyOutputType: WgslType | undefined;
	if (descriptor.typeFamily) {
		const selected = nodeData[descriptor.typeFamily.key];
		familyOutputType = isWgslType(selected)
			? selected
			: (descriptor.typeFamily.types[0] ?? "f32");
	}
	const activeInputs =
		familyOutputType && descriptor.resolveInputs
			? descriptor.resolveInputs(familyOutputType)
			: descriptor.inputs;

	// Phase 1: infer each input independently
	const rawInferred: Record<string, WgslType> = {};
	for (const inputDef of activeInputs) {
		const familyOverride = nodeOverrides?.[inputFamilyKey(inputDef)];
		if (familyOverride && isWgslType(familyOverride)) {
			rawInferred[inputDef.id] = familyOverride;
			continue;
		}
		const edgesForInput = incoming.filter((e) => e.targetHandle === inputDef.id);
		if (edgesForInput.length === 0 || inputDef.types.length === 1) {
			rawInferred[inputDef.id] = inputDefaultType(inputDef);
			continue;
		}
		const sourceTypes = edgesForInput.map((e) =>
			inferHandleType(e, resolveNode, resolveDescriptor, getIncomingEdges, definitions),
		);
		rawInferred[inputDef.id] = highestType(sourceTypes, inputDef.types);
	}

	// Phase 2: join every input of a family. Unconnected inputs only count when
	// the family is overridden, so a lone i32 source isn't widened to f32 by its
	// unconnected (default-typed) siblings.
	const familyCandidates = new Map<string, { types: readonly WgslType[]; found: WgslType[] }>();
	for (const inputDef of activeInputs) {
		const family = inputFamilyKey(inputDef);
		const entry = familyCandidates.get(family) ?? { types: inputDef.types, found: [] };
		const connected = incoming.some((e) => e.targetHandle === inputDef.id);
		const overridden = nodeOverrides?.[family] !== undefined;
		const inferred = rawInferred[inputDef.id];
		if (inferred && (connected || overridden)) entry.found.push(inferred);
		familyCandidates.set(family, entry);
	}
	const familyResolved = new Map<string, WgslType>();
	for (const [family, { types, found }] of familyCandidates) {
		familyResolved.set(family, highestType(found, types));
	}

	// Phase 3: all inputs in the same family get the family's resolved type
	const inputTypes: Record<string, WgslType> = {};
	for (const inputDef of activeInputs) {
		inputTypes[inputDef.id] =
			familyResolved.get(inputFamilyKey(inputDef)) ?? inputDefaultType(inputDef);
	}

	// Phase 4: resolve output type from the primary input
	const primary = activeInputs.find((i) => i.id === descriptor.primaryInput) ?? activeInputs[0];
	const representativeType = primary
		? (inputTypes[primary.id] ?? inputDefaultType(primary))
		: (descriptor.outputs[0]?.type ?? "f32");

	const outputType =
		familyOutputType ??
		(descriptor.resolveOutputType
			? descriptor.resolveOutputType(representativeType)
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
			? descriptor.resolveInputs(outputType)
			: activeInputs;

	return { inputTypes, outputType, resolvedInputs, resolvedOutputs };
}

/** The type carried by one output handle of a resolved node. */
function outputHandleType(resolved: ResolvedNodeTypes, handleId: string): WgslType {
	return resolved.resolvedOutputs.find((o) => o.id === handleId)?.type ?? resolved.outputType;
}

/**
 * Recursively resolve the WGSL type produced by an edge's source handle.
 */
function inferHandleType(
	edge: GraphDocumentEdge,
	resolveNode: (id: string) => GraphNode | undefined,
	resolveDescriptor: ResolveDescriptor,
	getIncomingEdges: GetIncomingEdges,
	definitions: HydratedGraphProject["definitions"],
): WgslType {
	const sourceNode = resolveNode(edge.source);
	if (!sourceNode) return "f32";

	const descriptor = resolveDescriptor(sourceNode);
	const incoming = getIncomingEdges(edge.source);
	const resolved = resolveNodeTypesForNode(
		sourceNode,
		descriptor,
		incoming,
		sourceNode.data,
		resolveNode,
		resolveDescriptor,
		getIncomingEdges,
		definitions,
	);
	return outputHandleType(resolved, edge.sourceHandle);
}

// ── TypeResolver class ────────────────────────────────────────────────────────

/**
 * Centralised, document-aware type resolver for the node graph.
 *
 * Responsibilities:
 * - Resolve per-input and output types for every node (single source of truth).
 * - Memoize results so repeated reads are O(1).
 * - Invalidate efficiently: walk backward from a changed node through the
 *   reverse graph, recomputing only affected ancestors. Stop at group-output
 *   boundaries (within the same document). Cross-document propagation goes
 *   through `node-group` instances.
 *
 * The resolver is document-agnostic: it receives a `resolveNode` callback and
 * a `definitions` map, so it can resolve types across the entire project
 * without depending on any mutable state.
 */
export class TypeResolver {
	/** Per-node memoized type resolution. Keyed by node ID. */
	cache = new Map<string, ResolvedNodeTypes>();

	private resolveDescriptor: ResolveDescriptor;
	private definitions: HydratedGraphProject["definitions"];
	private getIncomingEdges: GetIncomingEdges;

	constructor(
		resolveDescriptor: ResolveDescriptor,
		definitions: HydratedGraphProject["definitions"],
		getIncomingEdges: GetIncomingEdges,
	) {
		this.resolveDescriptor = resolveDescriptor;
		this.definitions = definitions;
		this.getIncomingEdges = getIncomingEdges;
	}

	// ── Public API ──────────────────────────────────────────────────────────

	/**
	 * Resolve types for a node, using the cache if available.
	 *
	 * @param node        The node to resolve.
	 * @param incoming    Edges targeting this node (from the node's document).
	 * @param resolveNode Callback to look up any node by ID across all documents.
	 */
	resolveNodeTypes(
		node: GraphNode,
		incoming: GraphDocumentEdge[],
		resolveNode: (id: string) => GraphNode | undefined,
	): ResolvedNodeTypes {
		const cached = this.cache.get(node.id);
		if (cached) return cached;

		const result = this.resolveNodeTypesUncached(node, incoming, node.data, resolveNode);
		this.cache.set(node.id, result);
		return result;
	}

	/**
	 * Resolve types for a node as if it held `data`, bypassing the cache:
	 * e.g. to see what its links infer without the user's type overrides.
	 */
	resolveNodeTypesUncached(
		node: GraphNode,
		incoming: GraphDocumentEdge[],
		data: Record<string, unknown>,
		resolveNode: (id: string) => GraphNode | undefined,
	): ResolvedNodeTypes {
		return resolveNodeTypesForNode(
			node,
			this.resolveDescriptor(node),
			incoming,
			data,
			resolveNode,
			this.resolveDescriptor,
			this.getIncomingEdges,
			this.definitions,
		);
	}

	/**
	 * Resolve the effective type for an input handle on a node.
	 * Reads from the memoised cache; recomputes if the node isn't cached yet.
	 */
	resolveInputType(
		nodeId: string,
		inputId: string,
		resolveNode: (id: string) => GraphNode | undefined,
		incoming: GraphDocumentEdge[],
	): WgslType {
		let cached = this.cache.get(nodeId);
		if (!cached) {
			const node = resolveNode(nodeId);
			if (!node) return "f32";
			cached = this.resolveNodeTypes(node, incoming, resolveNode);
		}
		const inputDef = cached.resolvedInputs.find((i) => i.id === inputId);
		return cached.inputTypes[inputId] ?? (inputDef ? inputDefaultType(inputDef) : "f32");
	}

	/**
	 * Resolve the output type for a node.
	 * Reads from the memoised cache; recomputes if the node isn't cached yet.
	 */
	resolveOutputType(
		nodeId: string,
		resolveNode: (id: string) => GraphNode | undefined,
		incoming: GraphDocumentEdge[],
	): WgslType {
		let cached = this.cache.get(nodeId);
		if (!cached) {
			const node = resolveNode(nodeId);
			if (!node) return "f32";
			cached = this.resolveNodeTypes(node, incoming, resolveNode);
		}
		return cached.outputType;
	}

	/**
	 * Resolve the active inputs for a node instance.
	 * Reads from the memoised cache; recomputes if the node isn't cached yet.
	 */
	resolveInputs(
		nodeId: string,
		resolveNode: (id: string) => GraphNode | undefined,
		incoming: GraphDocumentEdge[],
	): NodeInputDef[] {
		let cached = this.cache.get(nodeId);
		if (!cached) {
			const node = resolveNode(nodeId);
			if (!node) return [];
			cached = this.resolveNodeTypes(node, incoming, resolveNode);
		}
		return cached.resolvedInputs;
	}

	/**
	 * Resolve the active outputs for a node instance.
	 * Reads from the memoised cache; recomputes if the node isn't cached yet.
	 */
	resolveOutputs(
		nodeId: string,
		resolveNode: (id: string) => GraphNode | undefined,
		incoming: GraphDocumentEdge[],
	): NodeOutputDef[] {
		let cached = this.cache.get(nodeId);
		if (!cached) {
			const node = resolveNode(nodeId);
			if (!node) return [];
			cached = this.resolveNodeTypes(node, incoming, resolveNode);
		}
		return cached.resolvedOutputs;
	}

	/**
	 * Infer the type of an edge's source handle (recursive resolution).
	 * Equivalent to the old `inferHandleType` — uses the memoised cache.
	 */
	inferHandleType(
		edge: GraphDocumentEdge,
		resolveNode: (id: string) => GraphNode | undefined,
	): WgslType {
		const cached = this.cache.get(edge.source);
		if (cached) return outputHandleType(cached, edge.sourceHandle);

		return inferHandleType(
			edge,
			resolveNode,
			this.resolveDescriptor,
			this.getIncomingEdges,
			this.definitions,
		);
	}

	// ── Cache management ────────────────────────────────────────────────────

	/** Clear the entire cache. Called on project load. */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Invalidate a node and all its ancestors (backward walk through the
	 * reverse graph). Stops at group-output boundaries within the same
	 * document. Cross-document propagation goes through `node-group` instances.
	 *
	 * @returns The set of node IDs that were invalidated (for reactive updates).
	 */
	invalidate(
		nodeIds: string[],
		resolveNode: (id: string) => GraphNode | undefined,
		allEdges: GraphDocumentEdge[],
	): Set<string> {
		const invalidated = new Set<string>();

		for (const nodeId of nodeIds) {
			this.invalidateNodeAndAncestors(nodeId, resolveNode, allEdges, invalidated);
			this.invalidateGroupInstances(nodeId, resolveNode, invalidated);
		}

		// Walk forward from every invalidated node to recompute downstream dependents
		this.invalidateDescendants(invalidated, resolveNode, allEdges, invalidated);

		return invalidated;
	}

	// ── Internal ────────────────────────────────────────────────────────────

	/**
	 * Invalidate a single node and walk backward through the reverse graph
	 * to invalidate all ancestors. Stops at group-output boundaries.
	 */
	private invalidateNodeAndAncestors(
		startNodeId: string,
		resolveNode: (id: string) => GraphNode | undefined,
		allEdges: GraphDocumentEdge[],
		invalidated: Set<string>,
	): void {
		const queue: string[] = [startNodeId];

		while (queue.length > 0) {
			const nodeId = queue.shift();
			if (nodeId === undefined) break;
			if (invalidated.has(nodeId)) continue;

			const node = resolveNode(nodeId);
			if (!node) continue;

			// Stop at group-output boundaries: ancestors within the same
			// definition are not affected (group output types are statically
			// defined for UX simplicity).
			if (node.type === "group-output") {
				invalidated.add(nodeId);
				this.cache.delete(nodeId);
				continue;
			}

			invalidated.add(nodeId);
			this.cache.delete(nodeId);

			// Walk backward: find all nodes that feed into this node
			for (const edge of allEdges) {
				if (edge.target === nodeId && !invalidated.has(edge.source)) {
					queue.push(edge.source);
				}
			}
		}
	}

	/**
	 * Walk forward from every invalidated node through the forward graph
	 * to invalidate all downstream dependents. This ensures that when a
	 * node's output type changes (e.g. via override), all consumers recompute.
	 */
	private invalidateDescendants(
		seed: Set<string>,
		resolveNode: (id: string) => GraphNode | undefined,
		allEdges: GraphDocumentEdge[],
		invalidated: Set<string>,
	): void {
		const queue = [...seed];

		while (queue.length > 0) {
			const nodeId = queue.shift();
			if (nodeId === undefined) break;

			// Find all nodes that consume this node's output
			for (const edge of allEdges) {
				if (edge.source === nodeId && !invalidated.has(edge.target)) {
					const targetNode = resolveNode(edge.target);
					if (!targetNode) continue;

					// Stop at group-input boundaries: downstream types are resolved
					// via the group-input handle definitions, not internal wiring.
					if (targetNode.type === "group-input") continue;

					invalidated.add(edge.target);
					this.cache.delete(edge.target);
					queue.push(edge.target);
				}
			}
		}
	}

	/**
	 * If the changed node lives inside a group definition, find all
	 * `node-group` instances in parent documents that reference this
	 * definition, and invalidate them and their ancestors too.
	 * This is the cross-document propagation path.
	 */
	private invalidateGroupInstances(
		nodeId: string,
		resolveNode: (id: string) => GraphNode | undefined,
		invalidated: Set<string>,
	): void {
		// Find which definition this node belongs to
		let definitionRef: string | undefined;
		for (const [ref, def] of this.definitions) {
			if (def.nodesById.has(nodeId)) {
				definitionRef = ref;
				break;
			}
		}
		if (!definitionRef) return;

		// Search all documents (including root) for node-group instances of this definition
		for (const def of this.definitions.values()) {
			const instanceIds = def.nodes
				.filter((n) => n.type === "node-group" && n.group?.definitionRef === definitionRef)
				.map((n) => n.id);
			for (const instanceId of instanceIds) {
				if (!invalidated.has(instanceId)) {
					this.invalidateNodeAndAncestors(
						instanceId,
						resolveNode,
						def.edges,
						invalidated,
					);
				}
			}
		}
	}

	/**
	 * Compute types for all nodes in a document. Used for initial cache build.
	 */
	computeAll(
		nodes: GraphNode[],
		allEdges: GraphDocumentEdge[],
		resolveNode: (id: string) => GraphNode | undefined,
	): Map<string, ResolvedNodeTypes> {
		const targetEdgeMap = new Map<string, GraphDocumentEdge[]>();
		for (const edge of allEdges) {
			const list = targetEdgeMap.get(edge.target) ?? [];
			list.push(edge);
			targetEdgeMap.set(edge.target, list);
		}

		for (const node of nodes) {
			const incoming = targetEdgeMap.get(node.id) ?? [];
			this.resolveNodeTypes(node, incoming, resolveNode);
		}

		return new Map(this.cache);
	}
}
