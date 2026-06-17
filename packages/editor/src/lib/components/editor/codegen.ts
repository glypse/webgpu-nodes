import type { Edge, Node } from "@xyflow/svelte";
import { nodeRegistry } from "./registry";
import type { WgslType } from "./types";
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
	// For vector types, try to read individual components from the data object
	if (typeof value === "object" && value !== null) {
		const obj = value as Record<string, unknown>;
		switch (type) {
			case "vec2f":
				return `vec2f(f32(${toNum(obj.x, 0)}), f32(${toNum(obj.y, 0)}))`;
			case "vec3f":
				return `vec3f(f32(${toNum(obj.x, 0)}), f32(${toNum(obj.y, 0)}), f32(${toNum(obj.z, 0)}))`;
			case "vec4f":
				return `vec4f(f32(${toNum(obj.x, 0)}), f32(${toNum(obj.y, 0)}), f32(${toNum(obj.z, 0)}), f32(${toNum(obj.w, 1)}))`;
		}
	}
	return WGSL_DEFAULTS[type];
}

/**
 * Walk backwards from output nodes through edges to find all node IDs
 * that contribute to the final shader output.
 * Nodes not connected (directly or transitively) to any output node are excluded.
 */
function findReachableNodeIds(nodes: Map<string, Node>, edges: Edge[]): Set<string> {
	// Build reverse adjacency: target -> sources feeding into it
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

	// Seed the BFS from all output nodes
	for (const node of nodes.values()) {
		if (node.type === "output") {
			reachable.add(node.id);
			queue.push(node.id);
		}
	}

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break; // should never happen given the length check
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
 * Topological sort of node IDs.
 * Works on a DAG; throws if a cycle is detected.
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

/**
 * Produce the name of a variable holding the output of a node.
 * Each variable is a valid WGSL identifier.
 */
function getVarName(nodeId: string): string {
	return `v_${nodeId.replace(/[.-]/g, "_")}`;
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
 * Single-output sources: just `v_nodeId`.
 * Multi-output sources: `v_nodeId_outputName` — the sourceHandle tells us which output.
 */
function getSourceVar(edge: Edge, nodes: Map<string, Node>): string {
	const base = getVarName(edge.source);
	// Only append a suffix if the source node has multiple outputs.
	// Single-output nodes get no suffix even if sourceHandle is set (SvelteFlow always sets it).
	const sourceNode = nodes.get(edge.source);
	if (edge.sourceHandle && sourceNode?.type) {
		const sourceDescriptor = nodeRegistry[sourceNode.type];
		if (sourceDescriptor.outputs.length > 1) {
			return base + "_" + edge.sourceHandle;
		}
	}
	return base;
}

/**
 * Compute a stable hash from the graph state that actually affects the shader output.
 * Position changes, for example, produce the same hash — skipping rebuilds on drag.
 */
export function shaderHash(nodes: Node[], edges: Edge[]): string {
	return JSON.stringify({
		nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
		edges: edges.map((e) => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle
		}))
	});
}

/**
 * Emit the full WGSL fragment shader source from the graph.
 */
export function generateShader(nodes: Node[], edges: Edge[]): string {
	const nodeMap = new Map<string, Node>();
	for (const node of nodes) {
		nodeMap.set(node.id, node);
	}

	// Only keep nodes that contribute (directly or transitively) to an output node
	const reachableIds = findReachableNodeIds(nodeMap, edges);
	const filteredEdges = edges.filter(
		(e) => reachableIds.has(e.source) && reachableIds.has(e.target)
	);

	const sortedIds = topologicalSort(nodeMap, filteredEdges).filter((id) => reachableIds.has(id));

	// Build reverse map: target -> incoming edges (only from the reachable subgraph)
	const targetEdgeMap = new Map<string, Edge[]>();
	for (const edge of filteredEdges) {
		const list = targetEdgeMap.get(edge.target) ?? [];
		list.push(edge);
		targetEdgeMap.set(edge.target, list);
	}

	const lines: string[] = [];
	let resultVariable: string | null = null;

	for (const nodeId of sortedIds) {
		const node = nodeMap.get(nodeId);
		if (!node) continue;

		if (!node.type) continue;
		const descriptor = nodeRegistry[node.type];

		const varName = getVarName(nodeId);
		const incoming = targetEdgeMap.get(nodeId) ?? [];

		const outputVars: Record<string, string> = {};
		for (const outputDef of descriptor.outputs) {
			if (descriptor.outputs.length === 1) {
				outputVars[outputDef.name] = varName; // single output: no suffix (backwards compat)
			} else {
				outputVars[outputDef.name] = varName + "_" + outputDef.name;
			}
		}

		// Resolve inputs per descriptor definition
		const resolvedInputs: Record<string, string[]> = {};
		for (const inputDef of descriptor.inputs) {
			// If a node has only one input, SvelteFlow omits targetHandle on edges.
			// Match unlabeled edges to the sole input definition.
			const edgesForHandle = incoming.filter(
				(e) =>
					e.targetHandle === inputDef.name || (descriptor.inputs.length === 1 && !e.targetHandle)
			);
			const upstreamVars: string[] = [];

			if (inputDef.variadic) {
				for (const edge of edgesForHandle) {
					upstreamVars.push(getSourceVar(edge, nodeMap));
				}
			} else if (edgesForHandle.length > 0) {
				upstreamVars.push(getSourceVar(edgesForHandle[0], nodeMap));
			} else {
				// No connection → emit the node's own data value as a WGSL literal
				const dataVal: unknown = node.data[inputDef.name] ?? descriptor.defaultData[inputDef.name];
				const literal = formatWgslLiteral(inputDef.type, dataVal);
				upstreamVars.push(literal);
			}

			resolvedInputs[inputDef.name] = upstreamVars;
		}

		const wgslLines = descriptor.wgsl({
			varName,
			outputVars,
			data: node.data,
			inputs: resolvedInputs
		});

		for (const line of wgslLines) {
			lines.push(`  ${line}`);
		}

		// Track which node produces the output
		if (node.type === "output") {
			resultVariable = varName;
		}
	}

	// Build the fragment body
	const body: string[] = [
		"// ---------- Common libraries ----------",
		"",
		"fn safeDivF32(a: f32, b:f32) -> f32 {",
		"   return select(a / b, 0.0, b == 0.0);",
		"}",
		"",
		"// ---------- User code ----------",
		"",
		"fn frag(uv: vec2f) -> vec4f {"
	];

	for (const line of lines) {
		body.push(line);
	}

	if (resultVariable) {
		body.push(`  return ${resultVariable};`);
	} else {
		body.push("  return vec4f(0.0, 0.0, 0.0, 1.0);");
	}

	body.push("}");

	return body.join("\n");
}
