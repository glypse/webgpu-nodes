import { nodeRegistry } from "../components/editor/registry";
import type { Node, Edge } from "@xyflow/svelte";

export type Scene = {
	nodes: SceneNode[];
	edges: SceneEdge[];
};

export type SceneNode = {
	id: string;
	type: string;
	data: Record<string, unknown>;
	position: { x: number; y: number };
};

export type SceneEdge = {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
};

/**
 * Normalise a scene: fill in defaultData for any node that's missing fields,
 * discard unknown node types, etc.
 */
export function normaliseScene(scene: Scene): Scene {
	const nodes: SceneNode[] = [];
	for (const n of scene.nodes) {
		const desc = nodeRegistry[n.type];
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (desc === undefined) {
			console.warn(`[scene] unknown node type "${n.type}" — dropping`);
			continue;
		}
		nodes.push({
			...n,
			data: { ...desc.defaultData, ...n.data }
		});
	}
	return { nodes, edges: scene.edges };
}

/**
 * Hydrate a scene into the SvelteFlow Node/Edge arrays used by GraphContent.
 * Assigns a new id counter starting after the highest node id.
 */
export function hydrateScene(scene: Scene): { nodes: Node[]; edges: Edge[]; nextId: number } {
	const normalised = normaliseScene(scene);

	const nodes: Node[] = normalised.nodes.map((n) => ({
		id: n.id,
		type: n.type,
		data: n.data,
		position: n.position
	}));

	const edges: Edge[] = normalised.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
		sourceHandle: e.sourceHandle ?? undefined,
		targetHandle: e.targetHandle ?? undefined
	}));

	// Find the next id counter
	let maxId = 0;
	for (const n of normalised.nodes) {
		const num = parseInt(n.id.replace(/^node-/, ""), 10);
		if (Number.isFinite(num) && num > maxId) maxId = num;
	}

	return { nodes, edges, nextId: maxId + 1 };
}

/**
 * Serialise current nodes and edges to a Scene (ready to JSON.stringify).
 */
export function serialiseScene(nodes: Node[], edges: Edge[]): Scene {
	return {
		nodes: nodes.map(({ id, type, data, position }) => ({
			id,
			type: type ?? "",
			data,
			position
		})),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined
		}))
	};
}

/**
 * Save the current scene as a JSON download.
 */
export function saveScene(nodes: Node[], edges: Edge[]): void {
	const scene = serialiseScene(nodes, edges);
	const blob = new Blob([JSON.stringify(scene, null, "\t")], {
		type: "application/json"
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "scene.json";
	a.click();
	URL.revokeObjectURL(url);
}
