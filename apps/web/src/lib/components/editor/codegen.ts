import type { Edge } from "@xyflow/svelte";
import type { ShaderNode } from "./types";

/**
 * Topological sort of node IDs.
 * Works on a DAG; throws if a cycle is detected.
 */
function topologicalSort(nodes: Map<string, ShaderNode>, edges: Edge[]): string[] {
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
	// Replace hyphens and periods with underscores to make valid WGSL identifiers
	return `v_${nodeId.replace(/[.-]/g, "_")}`;
}

/**
 * Emit the full WGSL fragment shader source from the graph.
 */
export function generateShader(nodes: ShaderNode[], edges: Edge[]): string {
	const nodeMap = new Map<string, ShaderNode>();
	for (const node of nodes) {
		nodeMap.set(node.id, node);
	}

	const sortedIds = topologicalSort(nodeMap, edges);

	// Build reverse map: target -> incoming edges
	const targetEdgeMap = new Map<string, Edge[]>();
	for (const edge of edges) {
		const list = targetEdgeMap.get(edge.target) ?? [];
		list.push(edge);
		targetEdgeMap.set(edge.target, list);
	}

	const lines: string[] = [];
	let resultVariable: string | null = null;

	for (const nodeId of sortedIds) {
		const node = nodeMap.get(nodeId);
		if (!node) continue;

		const varName = getVarName(nodeId);
		const incoming = targetEdgeMap.get(nodeId) ?? [];

		switch (node.type) {
			case "float": {
				const { value: val } = node.data;
				lines.push(`  let ${varName} = f32(${String(val)});`);
				break;
			}

			case "add": {
				if (incoming.length < 2) {
					lines.push(`  // Add node "${nodeId}" needs at least 2 inputs`);
					lines.push(`  let ${varName} = f32(0.0);`);
				} else {
					const operands = incoming.map((e) => getVarName(e.source)).join(" + ");
					lines.push(`  let ${varName} = ${operands};`);
				}
				break;
			}

			case "combineVec4f": {
				const sourceByHandle = new Map<string, string>();
				for (const edge of incoming) {
					const handle = edge.targetHandle ?? "";
					sourceByHandle.set(handle, edge.source);
				}
				const getInput = (handle: string): string => {
					const src = sourceByHandle.get(handle);
					return src ? getVarName(src) : "f32(0.0)";
				};
				lines.push(
					`  let ${varName} = vec4f(${getInput("x")}, ${getInput("y")}, ${getInput("z")}, ${getInput("w")});`
				);
				break;
			}

			case "output": {
				resultVariable = varName;
				if (incoming.length > 0) {
					const sourceVar = getVarName(incoming[0].source);
					lines.push(`  let ${varName} = ${sourceVar};`);
				} else {
					lines.push(`  let ${varName} = vec4f(0.0, 0.0, 0.0, 1.0);`);
				}
				break;
			}

			default:
				lines.push(`  // Unknown node type: ${(node as ShaderNode).type}`);
				break;
		}
	}

	// Build the fragment body
	const body: string[] = ["fn frag(uv: vec2f) -> vec4f {"];

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
