import type { Node } from "@xyflow/svelte";

import type { GraphManager } from "./graph-state.svelte";
import { ROOT_ID, type GraphDocumentEdge, type HydratedEdge } from "./graph-types";
import type { HydratedGraphDocument } from "./hydrated-document.svelte";
import type { TypeResolver } from "./type-resolver";
import type { GroupedNode, HandleDef, NodeDescriptor, WgslType } from "./types";
import { WGSL_DEFAULTS, promoteVar, inputDefaultType } from "./types";
import { emitHelperFunctions } from "./wgsl-helpers";

/**
 * Safely convert an unknown value to a numeric WGSL literal component.
 */
function toNum(v: unknown, fallback: number): string {
	const n = Number(v);
	return String(Number.isFinite(n) ? n : fallback);
}

/**
 * Format a data value as a WGSL literal for a given type.
 */
function formatWgslLiteral(type: WgslType, value: unknown): string {
	if (type === "f32") {
		return `f32(${toNum(value, 0)})`;
	}
	if (typeof value === "object" && value !== null) {
		const obj = value as Record<string, unknown>;
		switch (type) {
			case "vec2f":
				return `vec2f(f32(${toNum(obj.x, 0)}), f32(${toNum(obj.y, 0)}))`;
			case "vec3f":
				return `vec3f(f32(${toNum(obj.x, 0)}), f32(${toNum(obj.y, 0)}), f32(${toNum(obj.z, 0)}))`;
			case "vec4f":
				return `vec4f(f32(${toNum(obj.x, 0)}), f32(${toNum(obj.y, 0)}), f32(${toNum(obj.z, 0)}), f32(${toNum(obj.w, 0)}))`;
		}
	}
	return WGSL_DEFAULTS[type];
}

/**
 * Walk backwards from seed-type nodes through edges to find all node IDs
 * that contribute to the final output. `seedType` is "frag-output" at root,
 * "group-output" inside any group's own subgraph - that's the only thing
 * that differs between generating the root shader and generating one group's function.
 */
function findReachableNodeIds(
	nodes: Map<string, Node>,
	edges: HydratedEdge[],
	seedType: string,
): Set<string> {
	const reverseAdj = new Map<string, string[]>();
	for (const node of nodes.values()) {
		reverseAdj.set(node.id, []);
	}
	for (const edge of edges) {
		const sources = reverseAdj.get(edge.target);
		if (sources) sources.push(edge.source);
	}

	const reachable = new Set<string>();
	const queue: string[] = [];

	for (const node of nodes.values()) {
		if (node.type === seedType) {
			reachable.add(node.id);
			queue.push(node.id);
		}
	}

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		for (const source of reverseAdj.get(current) ?? []) {
			if (!reachable.has(source)) {
				reachable.add(source);
				queue.push(source);
			}
		}
	}

	return reachable;
}

/**
 * Topological sort of node IDs. Works on a DAG; throws if a cycle is detected.
 */
function topologicalSort(nodes: Map<string, Node>, edges: HydratedEdge[]): string[] {
	const adjacency = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const node of nodes.values()) {
		adjacency.set(node.id, []);
		inDegree.set(node.id, 0);
	}

	for (const edge of edges) {
		const targets = adjacency.get(edge.source);
		if (targets) targets.push(edge.target);
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}

	const queue: string[] = [];
	for (const [id, degree] of inDegree) {
		if (degree === 0) queue.push(id);
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId) throw new Error("Unexpected empty queue");
		sorted.push(nodeId);
		for (const neighbor of adjacency.get(nodeId) ?? []) {
			const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
			inDegree.set(neighbor, newDegree);
			if (newDegree === 0) queue.push(neighbor);
		}
	}

	if (sorted.length !== nodes.size) {
		throw new Error("Cycle detected in the node graph - cannot generate shader");
	}

	return sorted;
}

function getVarName(nodeId: string): string {
	return `v_${nodeId.replace(/[.-]/g, "_")}`;
}

/** WGSL identifiers can't contain characters like "-" from a UUID's dashes. */
function sanitizeIdent(id: string): string {
	return `h_${id.replace(/[.-]/g, "_")}`;
}

export function debugSort(nodes: Node[], edges: HydratedEdge[]): string[] {
	const nodeMap = new Map<string, Node>();
	for (const node of nodes) {
		nodeMap.set(node.id, node);
	}
	return topologicalSort(nodeMap, edges);
}

/**
 * Resolve the WGSL variable name for a given edge's source.
 * - Single-output sources: `v_nodeId`.
 * - Multi-output sources (ordinary nodes): `v_nodeId_outputName`.
 * - Group-node sources: `v_nodeId.outputHandleId` - a field access on the
 *   struct the group's generated function returns, since a group's "outputs"
 *   are all produced by ONE function call, not separate `let` statements.
 */
function getSourceVar(
	edge: HydratedEdge,
	nodes: Map<string, Node>,
	resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
): string {
	const sourceNode = nodes.get(edge.source);
	if (sourceNode?.type === "group-input") {
		return sanitizeIdent(edge.sourceHandle); // it's a function parameter, not a let-var
	}
	const base = getVarName(edge.source);
	if (sourceNode?.type) {
		if (sourceNode.type === "node-group") {
			return `${base}.${sanitizeIdent(edge.sourceHandle)}`;
		}
		const sourceDescriptor = resolveDescriptor(sourceNode);
		if (sourceDescriptor.outputs.length > 1) {
			return base + "_" + edge.sourceHandle;
		}
	}
	return base;
}

/**
 * Resolve the WGSL type produced by an edge's source handle. Uses the
 * TypeResolver for dynamic output types (not static descriptor types).
 * Returns "f32" if it can't be determined (fail soft).
 */
function getSourceType(
	edge: HydratedEdge,
	typeResolver: TypeResolver,
	resolveNode: (id: string) => GroupedNode | undefined,
): WgslType {
	const sourceNode = resolveNode(edge.source);
	if (!sourceNode) return "f32";
	if (sourceNode.type === "group-input") {
		const handle = (sourceNode.data.handles as HandleDef[] | undefined)?.find(
			(h) => h.id === edge.sourceHandle,
		);
		return handle?.type ?? "f32";
	}
	return typeResolver.inferHandleType(
		{
			id: "",
			source: edge.source,
			sourceHandle: edge.sourceHandle,
			target: "",
			targetHandle: "",
		},
		resolveNode,
	);
}

/**
 * Compute a stable hash from the graph state that actually affects the shader output.
 */
export function shaderHash(nodes: Node[], edges: HydratedEdge[]): string {
	return JSON.stringify({
		nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
		edges: edges.map((e) => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle,
		})),
	});
}

/**
 * Hash the entire project (all definitions) so that edits inside any
 * subgraph also trigger a re-generation of the shader.
 */
export function projectHash(project: {
	definitions: Map<string, { nodes: Node[]; edges: HydratedEdge[] }>;
}): string {
	function stripLabels(data: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data)) {
			if (k === "handles" && Array.isArray(v)) {
				out[k] = v.map((h): { id: string; type: string } => {
					if (typeof h === "object" && h !== null && "id" in h && "type" in h) {
						const handle = h as { id: string; label: string; type: string };
						return { id: handle.id, type: handle.type };
					}
					return { id: "", type: "" };
				});
			} else {
				out[k] = v;
			}
		}
		return out;
	}

	return JSON.stringify(
		Object.fromEntries(
			[...project.definitions.entries()].map(([key, doc]) => [
				key,
				{
					nodes: doc.nodes.map((n) => ({
						id: n.id,
						type: n.type,
						data: stripLabels(n.data),
					})),
					edges: doc.edges.map((e) => ({
						source: e.source,
						target: e.target,
						sourceHandle: e.sourceHandle,
						targetHandle: e.targetHandle,
					})),
				},
			]),
		),
	);
}

/**
 * Hash only the subset of the project that actually contributes to the shader
 * output: nodes reachable from frag-output in the root document, the edges
 * between them, and any group definitions they reference (recursively).
 * Changes to disconnected nodes or unused group definitions won't change
 * this hash, avoiding unnecessary shader regeneration.
 */
export function reachableShaderHash(project: {
	definitions: Map<string, { nodes: Node[]; edges: HydratedEdge[] }>;
}): string {
	function stripLabels(data: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data)) {
			if (k === "handles" && Array.isArray(v)) {
				out[k] = v.map((h): { id: string; type: string } => {
					if (typeof h === "object" && h !== null && "id" in h && "type" in h) {
						const handle = h as { id: string; label: string; type: string };
						return { id: handle.id, type: handle.type };
					}
					return { id: "", type: "" };
				});
			} else {
				out[k] = v;
			}
		}
		return out;
	}

	function hashDoc(doc: { nodes: Node[]; edges: HydratedEdge[] }) {
		return {
			nodes: doc.nodes.map((n) => ({
				id: n.id,
				type: n.type,
				data: stripLabels(n.data),
			})),
			edges: doc.edges.map((e) => ({
				source: e.source,
				target: e.target,
				sourceHandle: e.sourceHandle,
				targetHandle: e.targetHandle,
			})),
		};
	}

	const root = project.definitions.get(ROOT_ID);
	if (!root) return "";

	// 1. Find reachable node IDs from frag-output in the root document.
	const nodeMap = new Map<string, GroupedNode>();
	for (const node of root.nodes) nodeMap.set(node.id, node);
	const reachableRootIds = findReachableNodeIds(nodeMap, root.edges, "frag-output");

	// 2. Collect group definitions referenced by reachable group nodes (recursively).
	const visitedGroupDefs = new Set<string>();
	const defQueue: string[] = [];
	for (const nodeId of reachableRootIds) {
		const node = nodeMap.get(nodeId);
		if (node?.type === "node-group" && node.group) {
			if (!visitedGroupDefs.has(node.group.definitionRef)) {
				visitedGroupDefs.add(node.group.definitionRef);
				defQueue.push(node.group.definitionRef);
			}
		}
	}
	while (defQueue.length > 0) {
		const ref = defQueue.pop();
		if (ref === undefined) break;
		const def = project.definitions.get(ref);
		if (!def) continue;
		for (const node of def.nodes) {
			const groupedNode = node as GroupedNode;
			if (groupedNode.type === "node-group" && groupedNode.group) {
				if (!visitedGroupDefs.has(groupedNode.group.definitionRef)) {
					visitedGroupDefs.add(groupedNode.group.definitionRef);
					defQueue.push(groupedNode.group.definitionRef);
				}
			}
		}
	}

	// 3. Hash only the reachable root nodes/edges and the referenced definitions.
	const reachableRootNodes = root.nodes.filter((n) => reachableRootIds.has(n.id));
	const reachableRootEdges = root.edges.filter(
		(e) => reachableRootIds.has(e.source) && reachableRootIds.has(e.target),
	);

	const defs: Record<string, ReturnType<typeof hashDoc>> = {};
	for (const ref of visitedGroupDefs) {
		const def = project.definitions.get(ref);
		if (def) defs[ref] = hashDoc(def);
	}

	return JSON.stringify({
		root: hashDoc({ nodes: reachableRootNodes, edges: reachableRootEdges }),
		defs,
	});
}

/**
 * Every group's generated `struct` + `fn` text, collected once per distinct
 * definitionRef while walking the whole graph (root + every nested group).
 * Keying by definitionRef is what gives you memoization for free: two locked
 * instances of the same group ask for the same key, so the second lookup
 * short-circuits `emitGroupFunction` instead of generating a duplicate.
 */
type GroupDecls = Map<
	string,
	{
		structDecl: string;
		fnDecl: string;
		fnName: string;
		structName: string;
	}
>;

/**
 * The reusable "walk one subgraph and emit its body lines" logic - this is the
 * part of the old generateShader that had nothing to do with being the root.
 * Used both for the root fragment body and for every group's function body.
 *
 * Returns the emitted lines AND the variable name that should be returned -
 * for root that's whatever feeds frag-output; for a group, we build a struct
 * literal from whatever feeds group-output instead (handled by the caller).
 */
function generateBody(
	nodes: Node[],
	edges: HydratedEdge[],
	seedType: string,
	groupDecls: GroupDecls,
	typeResolver: TypeResolver,
	resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
	resolveNode: (id: string) => GroupedNode | undefined,
	getGroupDefinition: (definitionRef: string) => HydratedGraphDocument | undefined,
): {
	lines: string[];
	seedNodeVarName: string | null;
	/**
	 * TODO: lineMap will be used to highlight faulty edges in-UI
	 */
	lineMap: Map<string, { start: number; end: number }>;
} {
	const nodeMap = new Map<string, Node>();
	for (const node of nodes) {
		nodeMap.set(node.id, node);
	}

	const reachableIds = findReachableNodeIds(nodeMap, edges, seedType);
	const filteredEdges = edges.filter(
		(e) => reachableIds.has(e.source) && reachableIds.has(e.target),
	);
	const sortedIds = topologicalSort(nodeMap, filteredEdges).filter((id) => reachableIds.has(id));

	const targetEdgeMap = new Map<string, HydratedEdge[]>();
	for (const edge of filteredEdges) {
		const list = targetEdgeMap.get(edge.target) ?? [];
		list.push(edge);
		targetEdgeMap.set(edge.target, list);
	}

	const lines: string[] = [];
	const lineMap = new Map<string, { start: number; end: number }>();
	let seedNodeVarName: string | null = null;

	for (const nodeId of sortedIds) {
		const node = nodeMap.get(nodeId);
		if (!node?.type) continue;

		const varName = getVarName(nodeId);
		const incoming = targetEdgeMap.get(nodeId) ?? [];

		// Group nodes don't call descriptor.wgsl() the normal way - they need
		// their own function generated first (recursively), THEN a one-line
		// call to it. Every other node type falls through to the shared path below.
		if (node.type === "node-group") {
			const groupedNode = node as GroupedNode;
			const definitionRef = groupedNode.group?.definitionRef;
			if (definitionRef) {
				emitGroupFunctionIfNeeded(
					definitionRef,
					groupDecls,
					typeResolver,
					resolveDescriptor,
					resolveNode,
					getGroupDefinition,
				);
				const decl = groupDecls.get(definitionRef);
				if (decl) {
					const groupedDescriptor = resolveDescriptor(groupedNode);
					const inputArgs = groupedDescriptor.inputs.map((inputDef) => {
						const edgesForHandle = incoming.filter(
							(e) => e.targetHandle === inputDef.id,
						);
						const firstEdge = edgesForHandle[0];
						if (firstEdge) {
							const raw = getSourceVar(firstEdge, nodeMap, resolveDescriptor);
							const sourceType = getSourceType(firstEdge, typeResolver, resolveNode);
							return promoteVar(raw, sourceType, inputDefaultType(inputDef));
						}
						const dataVal =
							node.data[inputDef.id] ?? groupedDescriptor.defaultData[inputDef.id];
						return formatWgslLiteral(inputDefaultType(inputDef), dataVal);
					});
					const callArgs = inputArgs;
					const startLine = lines.length;
					lines.push(`  let ${varName} = ${decl.fnName}(${callArgs.join(", ")});`);
					lineMap.set(nodeId, { start: startLine, end: lines.length });
				}
			}
			continue;
		}

		if (node.type === "group-input" || node.type === "group-output") {
			continue; // sinks/sources handled structurally by emitGroupFunctionIfNeeded, not via .wgsl()
		}

		const descriptor = resolveDescriptor(node);

		// Node-wide type resolution (single source of truth via TypeResolver)
		const incomingForResolver = incoming as GraphDocumentEdge[];
		const { inputTypes, outputType, resolvedInputs, resolvedOutputs } =
			typeResolver.resolveNodeTypes(node, incomingForResolver, resolveNode);

		const outputVars: Record<string, string> = {};
		for (const outputDef of resolvedOutputs) {
			outputVars[outputDef.id] =
				resolvedOutputs.length === 1 ? varName : varName + "_" + outputDef.id;
		}

		// Build input variable map – variadic inputs are pre-promoted, non-variadic are raw
		const ctxInputs: Record<string, string[]> = {};
		for (const inputDef of resolvedInputs) {
			const edgesForHandle = incoming.filter((e) => e.targetHandle === inputDef.id);
			const resolvedType = inputTypes[inputDef.id] ?? inputDefaultType(inputDef);

			if (inputDef.variadic) {
				// Pre-promote each variadic operand to the resolved type
				ctxInputs[inputDef.id] = edgesForHandle.map((e) => {
					const raw = getSourceVar(e, nodeMap, resolveDescriptor);
					const sourceType = getSourceType(e, typeResolver, resolveNode);
					return promoteVar(raw, sourceType, resolvedType);
				});
			} else if (edgesForHandle.length > 0) {
				const firstEdge = edgesForHandle[0];
				if (firstEdge) {
					ctxInputs[inputDef.id] = [getSourceVar(firstEdge, nodeMap, resolveDescriptor)];
				} else {
					ctxInputs[inputDef.id] = [];
				}
			} else {
				const dataVal: unknown =
					node.data[inputDef.id] ?? descriptor.defaultData[inputDef.id];
				ctxInputs[inputDef.id] = [formatWgslLiteral(resolvedType, dataVal)];
			}
		}

		// Build the promoteInput helper for non-variadic inputs
		const promoteInput = (id: string): string => {
			const rawList = ctxInputs[id] ?? [];
			const inputDef =
				resolvedInputs.find((i) => i.id === id) ??
				descriptor.inputs.find((i) => i.id === id);
			if (!inputDef) return "f32(0.0)";

			const resolvedType = inputTypes[id] ?? inputDefaultType(inputDef);
			const raw = rawList[0] ?? WGSL_DEFAULTS[resolvedType];
			const edge = incoming.find((e) => e.targetHandle === id);
			const sourceType = edge ? getSourceType(edge, typeResolver, resolveNode) : resolvedType;
			return promoteVar(raw, sourceType, resolvedType);
		};

		const wgslLines = descriptor.wgsl({
			varName,
			outputVars,
			data: node.data,
			inputs: ctxInputs,
			inputTypes,
			outputType,
			resolvedOutputs,
			resolvedInputs,
			promoteInput,
		});
		const startLine = lines.length;
		for (const line of wgslLines) lines.push(`  ${line}`);
		lineMap.set(nodeId, { start: startLine, end: lines.length });

		if (node.type === seedType) seedNodeVarName = varName;
	}

	return { lines, seedNodeVarName, lineMap };
}

/**
 * Generate one group's `struct` + `fn`, recursively (a group can contain
 * another group - this just calls generateBody again, unchanged).
 * No-ops if this definitionRef is already in groupDecls - that's the memoization.
 */
function emitGroupFunctionIfNeeded(
	definitionRef: string,
	groupDecls: GroupDecls,
	typeResolver: TypeResolver,
	resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
	resolveNode: (id: string) => GroupedNode | undefined,
	getGroupDefinition: (definitionRef: string) => HydratedGraphDocument | undefined,
): void {
	if (groupDecls.has(definitionRef)) return; // memoized - already generated

	const definition = getGroupDefinition(definitionRef);
	if (!definition) return;

	const groupOutputNode = definition.nodes.find((n) => n.type === "group-output");
	const handles = (groupOutputNode?.data.handles ?? []) as HandleDef[];

	const groupInputNode = definition.nodes.find((n) => n.type === "group-input");
	const inputHandles = (groupInputNode?.data.handles ?? []) as HandleDef[];

	const ident = sanitizeIdent(definitionRef);
	const fnName = `group_${ident}`;
	const structName = `GroupOutputs_${ident}`;

	const { lines } = generateBody(
		definition.nodes,
		definition.edges,
		"group-output",
		groupDecls,
		typeResolver,
		resolveDescriptor,
		resolveNode,
		getGroupDefinition,
	);

	// Resolve actual types from the internal wiring via the TypeResolver,
	// rather than relying on HandleDef.type which can drift from the wiring.
	const nodeMap = new Map<string, Node>();
	for (const n of definition.nodes) nodeMap.set(n.id, n);

	// Output struct fields: use the group-output node's resolved input types
	// (these are the types the internal wiring actually delivers to each handle).
	const resolvedOutputTypes: WgslType[] = handles.map((h) => {
		if (!groupOutputNode) return h.type;
		const incoming = definition.edgesByTarget.get(groupOutputNode.id) ?? [];
		return typeResolver.resolveInputType(groupOutputNode.id, h.id, resolveNode, incoming);
	});

	// Input function parameters: use the group-input node's resolved output types
	// (these are the types the group-input node actually produces for each handle).
	const resolvedInputTypes: WgslType[] = inputHandles.map((h) => {
		if (!groupInputNode) return h.type;
		const incoming = definition.edgesByTarget.get(groupInputNode.id) ?? [];
		const resolvedOutputs = typeResolver.resolveOutputs(
			groupInputNode.id,
			resolveNode,
			incoming,
		);
		const outputDef = resolvedOutputs.find((o) => o.id === h.id);
		return outputDef?.type ?? h.type;
	});

	// The group-output node itself never emits a `let` (it's a sink, not computed) -
	// build the struct literal directly from whatever feeds each of its handles.
	const outputEdges = groupOutputNode
		? (definition.edgesByTarget.get(groupOutputNode.id) ?? [])
		: [];

	const fieldAssignments = handles.map((h, i) => {
		const edge = outputEdges.find((e) => e.targetHandle === h.id);
		const resolvedType = resolvedOutputTypes[i] ?? h.type;
		return edge ? getSourceVar(edge, nodeMap, resolveDescriptor) : WGSL_DEFAULTS[resolvedType];
	});

	const structFields = handles
		.map((h, i) => `  ${sanitizeIdent(h.id)}: ${resolvedOutputTypes[i] ?? h.type},`)
		.join("\n");
	const structDecl = `struct ${structName} {\n${structFields}\n}`;

	// Group's inputs: use resolved types from the group-input node
	const params = inputHandles
		.map((h, i) => `${sanitizeIdent(h.id)}: ${resolvedInputTypes[i] ?? h.type}`)
		.join(", ");

	const fnDecl = [
		`fn ${fnName}(${params}) -> ${structName} {`,
		...lines,
		`  return ${structName}(${fieldAssignments.join(", ")});`,
		`}`,
	].join("\n");

	groupDecls.set(definitionRef, { structDecl, fnDecl, fnName, structName });
}

/**
 * Emit the full WGSL fragment shader source from the graph.
 */
/** The slice of the GraphManager that code generation depends on. */
export type CodegenGraph = Pick<
	GraphManager,
	"root" | "project" | "typeResolver" | "resolveDescriptor" | "resolveNode"
>;

export function generateShader(graph: CodegenGraph): {
	shader: string;
	lineMap: Map<string, { start: number; end: number }>;
} {
	const { nodes, edges } = graph.root;
	const groupDecls: GroupDecls = new Map();

	const resolveDescriptor = (node: GroupedNode) => graph.resolveDescriptor(node);
	const resolveNode = (id: string) => graph.resolveNode(id);
	const getGroupDefinition = (definitionRef: string) =>
		graph.project.definitions.get(definitionRef);

	// Single source of truth: reuse the GraphManager's TypeResolver
	const typeResolver = graph.typeResolver;

	const { lines, seedNodeVarName, lineMap } = generateBody(
		nodes,
		edges,
		"frag-output",
		groupDecls,
		typeResolver,
		resolveDescriptor,
		resolveNode,
		getGroupDefinition,
	);

	const preamble: string[] = [];

	// Every group's struct + fn, emitted once each, before frag() itself.
	for (const decl of groupDecls.values()) {
		preamble.push(decl.structDecl, "", decl.fnDecl, "");
	}

	preamble.push(
		"// ---------- Common libraries ----------",
		"",
		...emitHelperFunctions().flatMap((fn) => [fn, ""]),
		"// ---------- User code ----------",
		"",
		"fn frag(uv: vec2f) -> vec4f {",
	);

	const preambleText = preamble.join("\n");
	const preambleLineCount = preambleText.split("\n").length;

	// Offset the line map by the preamble line count so line numbers
	// correspond to the final shader string.
	const finalLineMap = new Map<string, { start: number; end: number }>();
	for (const [nodeId, range] of lineMap) {
		finalLineMap.set(nodeId, {
			start: range.start + preambleLineCount,
			end: range.end + preambleLineCount,
		});
	}

	const body: string[] = [
		...preamble,
		...lines,
		seedNodeVarName ? `  return ${seedNodeVarName};` : "  return vec4f(0.0, 0.0, 0.0, 0.0);",
		"}",
	];

	return { shader: body.join("\n"), lineMap: finalLineMap };
}
