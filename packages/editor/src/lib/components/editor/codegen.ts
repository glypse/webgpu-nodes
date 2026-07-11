import type { Edge, Node } from "@xyflow/svelte";

import { getGraphManager } from "./graph-state.svelte";
import type { GroupedNode, HandleDef, NodeDescriptor, WgslType } from "./types";
import { WGSL_DEFAULTS } from "./types";

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
 * "group-output" inside any group's own subgraph — that's the only thing
 * that differs between generating the root shader and generating one group's function.
 */
function findReachableNodeIds(
	nodes: Map<string, Node>,
	edges: Edge[],
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
 * Unchanged from before — this never needed to know about groups at all.
 */
function topologicalSort(nodes: Map<string, Node>, edges: Edge[]): string[] {
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
		throw new Error("Cycle detected in the node graph — cannot generate shader");
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

export function debugSort(nodes: Node[], edges: Edge[]): string[] {
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
 * - Group-node sources: `v_nodeId.outputHandleId` — a field access on the
 *   struct the group's generated function returns, since a group's "outputs"
 *   are all produced by ONE function call, not separate `let` statements.
 */
function getSourceVar(
	edge: Edge,
	nodes: Map<string, Node>,
	resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
): string {
	const sourceNode = nodes.get(edge.source);
	if (sourceNode?.type === "group-input" && edge.sourceHandle) {
		return sanitizeIdent(edge.sourceHandle); // it's a function parameter, not a let-var
	}
	const base = getVarName(edge.source);
	if (edge.sourceHandle && sourceNode?.type) {
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
 * Compute a stable hash from the graph state that actually affects the shader output.
 */
export function shaderHash(nodes: Node[], edges: Edge[]): string {
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
 * Hash the entire project (root + all definitions) so that edits inside any
 * subgraph also trigger a re-generation of the shader.
 */
export function projectHash(project: {
	root: { nodes: Node[]; edges: Edge[] };
	definitions: Record<string, { nodes: Node[]; edges: Edge[] }>;
}): string {
	return JSON.stringify({
		root: {
			nodes: project.root.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
			edges: project.root.edges.map((e) => ({
				source: e.source,
				target: e.target,
				sourceHandle: e.sourceHandle,
				targetHandle: e.targetHandle,
			})),
		},
		definitions: Object.fromEntries(
			Object.entries(project.definitions).map(([key, doc]) => [
				key,
				{
					nodes: doc.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
					edges: doc.edges.map((e) => ({
						source: e.source,
						target: e.target,
						sourceHandle: e.sourceHandle,
						targetHandle: e.targetHandle,
					})),
				},
			]),
		),
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
	{ structDecl: string; fnDecl: string; fnName: string; structName: string }
>;

/**
 * The reusable "walk one subgraph and emit its body lines" logic — this is the
 * part of the old generateShader that had nothing to do with being the root.
 * Used both for the root fragment body and for every group's function body.
 *
 * Returns the emitted lines AND the variable name that should be returned —
 * for root that's whatever feeds frag-output; for a group, we build a struct
 * literal from whatever feeds group-output instead (handled by the caller).
 */
function generateBody(
	nodes: Node[],
	edges: Edge[],
	seedType: string,
	groupDecls: GroupDecls,
	resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
	getGroupDefinition: (definitionRef: string) => { nodes: Node[]; edges: Edge[] } | undefined,
): { lines: string[]; seedNodeVarName: string | null } {
	const nodeMap = new Map<string, Node>();
	for (const node of nodes) {
		nodeMap.set(node.id, node);
	}

	const reachableIds = findReachableNodeIds(nodeMap, edges, seedType);
	const filteredEdges = edges.filter(
		(e) => reachableIds.has(e.source) && reachableIds.has(e.target),
	);
	const sortedIds = topologicalSort(nodeMap, filteredEdges).filter((id) => reachableIds.has(id));

	const targetEdgeMap = new Map<string, Edge[]>();
	for (const edge of filteredEdges) {
		const list = targetEdgeMap.get(edge.target) ?? [];
		list.push(edge);
		targetEdgeMap.set(edge.target, list);
	}

	const lines: string[] = [];
	let seedNodeVarName: string | null = null;

	for (const nodeId of sortedIds) {
		const node = nodeMap.get(nodeId);
		if (!node?.type) continue;

		const varName = getVarName(nodeId);
		const incoming = targetEdgeMap.get(nodeId) ?? [];

		// Group nodes don't call descriptor.wgsl() the normal way — they need
		// their own function generated first (recursively), THEN a one-line
		// call to it. Every other node type falls through to the shared path below.
		if (node.type === "node-group") {
			const groupedNode = node as GroupedNode;
			const definitionRef = groupedNode.group?.definitionRef;
			if (definitionRef) {
				emitGroupFunctionIfNeeded(
					definitionRef,
					groupDecls,
					resolveDescriptor,
					getGroupDefinition,
				);
				const decl = groupDecls.get(definitionRef);
				if (decl) {
					const descriptor = resolveDescriptor(groupedNode);
					const callArgs = descriptor.inputs.map((inputDef) => {
						const edgesForHandle = incoming.filter(
							(e) =>
								e.targetHandle === inputDef.name ||
								(descriptor.inputs.length === 1 && !e.targetHandle),
						);
						const firstEdge = edgesForHandle[0];
						if (firstEdge) return getSourceVar(firstEdge, nodeMap, resolveDescriptor);
						const dataVal =
							node.data[inputDef.name] ?? descriptor.defaultData[inputDef.name];
						return formatWgslLiteral(inputDef.type, dataVal);
					});
					lines.push(`  let ${varName} = ${decl.fnName}(${callArgs.join(", ")});`);
				}
			}
			continue;
		}

		if (node.type === "group-input" || node.type === "group-output") {
			continue; // sinks/sources handled structurally by emitGroupFunctionIfNeeded, not via .wgsl()
		}

		const descriptor = resolveDescriptor(node);

		const outputVars: Record<string, string> = {};
		for (const outputDef of descriptor.outputs) {
			outputVars[outputDef.name] =
				descriptor.outputs.length === 1 ? varName : varName + "_" + outputDef.name;
		}

		const resolvedInputs: Record<string, string[]> = {};
		for (const inputDef of descriptor.inputs) {
			const edgesForHandle = incoming.filter(
				(e) =>
					e.targetHandle === inputDef.name ||
					(descriptor.inputs.length === 1 && !e.targetHandle),
			);
			const upstreamVars: string[] = [];

			if (inputDef.variadic) {
				for (const edge of edgesForHandle) {
					upstreamVars.push(getSourceVar(edge, nodeMap, resolveDescriptor));
				}
			} else if (edgesForHandle.length > 0) {
				const firstEdge = edgesForHandle[0];
				if (firstEdge)
					upstreamVars.push(getSourceVar(firstEdge, nodeMap, resolveDescriptor));
			} else {
				const dataVal: unknown =
					node.data[inputDef.name] ?? descriptor.defaultData[inputDef.name];
				upstreamVars.push(formatWgslLiteral(inputDef.type, dataVal));
			}

			resolvedInputs[inputDef.name] = upstreamVars;
		}

		const wgslLines = descriptor.wgsl({
			varName,
			outputVars,
			data: node.data,
			inputs: resolvedInputs,
		});
		for (const line of wgslLines) lines.push(`  ${line}`);

		if (node.type === seedType) seedNodeVarName = varName;
	}

	return { lines, seedNodeVarName };
}

/**
 * Generate one group's `struct` + `fn`, recursively (a group can contain
 * another group — this just calls generateBody again, unchanged).
 * No-ops if this definitionRef is already in groupDecls — that's the memoization.
 */
function emitGroupFunctionIfNeeded(
	definitionRef: string,
	groupDecls: GroupDecls,
	resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
	getGroupDefinition: (definitionRef: string) => { nodes: Node[]; edges: Edge[] } | undefined,
): void {
	if (groupDecls.has(definitionRef)) return; // memoized — already generated

	const definition = getGroupDefinition(definitionRef);
	if (!definition) return;

	const groupOutputNode = definition.nodes.find((n) => n.type === "group-output");
	const handles = (groupOutputNode?.data.handles ?? []) as HandleDef[];

	const ident = sanitizeIdent(definitionRef);
	const fnName = `group_${ident}`;
	const structName = `GroupOutputs_${ident}`;

	const { lines } = generateBody(
		definition.nodes,
		definition.edges,
		"group-output",
		groupDecls,
		resolveDescriptor,
		getGroupDefinition,
	);

	// The group-output node itself never emits a `let` (it's a sink, not computed) —
	// build the struct literal directly from whatever feeds each of its handles.
	const outputEdges = definition.edges.filter((e) => e.target === groupOutputNode?.id);
	const nodeMap = new Map<string, Node>();
	for (const n of definition.nodes) nodeMap.set(n.id, n);

	const fieldAssignments = handles.map((h) => {
		const edge = outputEdges.find((e) => e.targetHandle === h.id);
		return edge ? getSourceVar(edge, nodeMap, resolveDescriptor) : WGSL_DEFAULTS[h.type];
	});

	const structFields = handles.map((h) => `  ${sanitizeIdent(h.id)}: ${h.type},`).join("\n");
	const structDecl = `struct ${structName} {\n${structFields}\n}`;

	// Group's inputs (its parameters) come from the group-input node's handles.
	const groupInputNode = definition.nodes.find((n) => n.type === "group-input");
	const inputHandles = (groupInputNode?.data.handles ?? []) as HandleDef[];
	const params = inputHandles.map((h) => `${sanitizeIdent(h.id)}: ${h.type}`).join(", ");

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
export function generateShader(nodes: Node[], edges: Edge[]): string {
	const graph = getGraphManager();
	const groupDecls: GroupDecls = new Map();

	const resolveDescriptor = (node: GroupedNode) => graph.resolveDescriptor(node);
	const getGroupDefinition = (definitionRef: string) => graph.project.definitions[definitionRef];

	const { lines, seedNodeVarName } = generateBody(
		nodes,
		edges,
		"frag-output",
		groupDecls,
		resolveDescriptor,
		getGroupDefinition,
	);

	const body: string[] = [];

	// Every group's struct + fn, emitted once each, before frag() itself.
	for (const decl of groupDecls.values()) {
		body.push(decl.structDecl, "", decl.fnDecl, "");
	}

	body.push(
		"// ---------- Common libraries ----------",
		"",
		"fn safeDivF32(a: f32, b:f32) -> f32 {",
		"  return select(a / b, 0.0, b == 0.0);",
		"}",
		"",
		"// ---------- User code ----------",
		"",
		"fn frag(uv: vec2f) -> vec4f {",
		...lines,
		seedNodeVarName ? `  return ${seedNodeVarName};` : "  return vec4f(0.0, 0.0, 0.0, 1.0);",
		"}",
	);

	return body.join("\n");
}
