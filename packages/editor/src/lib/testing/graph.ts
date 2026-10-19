import { generateShader } from "../codegen";
import { GraphManager } from "../graph-state.svelte";
import {
	type GraphDocumentEdge,
	type GraphDocumentNode,
	type GraphProject,
	ROOT_ID,
} from "../graph-types";

export type TestNode = {
	id: string;
	type: string;
	data?: Record<string, unknown>;
	group?: GraphDocumentNode["group"];
};

/** `[source, sourceHandle, target, targetHandle]` */
export type TestEdge = [string, string, string, string];

export function edge([source, sourceHandle, target, targetHandle]: TestEdge): GraphDocumentEdge {
	return {
		id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
		source,
		sourceHandle,
		target,
		targetHandle,
	};
}

/** Build a one-document project. A `frag-output` node with id "out" is always present. */
export function rootProject(nodes: TestNode[], edges: TestEdge[]): GraphProject {
	const docNodes: GraphDocumentNode[] = [
		{ id: "out", type: "frag-output", data: {}, position: { x: 0, y: 0 } },
		...nodes.map((n, i) => ({
			id: n.id,
			type: n.type,
			data: n.data ?? {},
			position: { x: i * 200, y: 0 },
			...(n.group ? { group: n.group } : {}),
		})),
	];
	return { definitions: { [ROOT_ID]: { nodes: docNodes, edges: edges.map(edge) } } };
}

export function managerFor(nodes: TestNode[], edges: TestEdge[]): GraphManager {
	return new GraphManager(rootProject(nodes, edges));
}

export function shaderFor(nodes: TestNode[], edges: TestEdge[]): string {
	return generateShader(managerFor(nodes, edges)).shader;
}
