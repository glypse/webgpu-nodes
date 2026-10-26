import type {
	ELK,
	ElkExtendedEdge,
	ElkNode,
	ElkPort,
	LayoutOptions as ElkOptions,
} from "elkjs/lib/elk-api";

import type { GraphEdge, GraphNode } from "../graph/document";
import type { ZoneAnalysis } from "../zones";

type Point = { x: number; y: number };

/**
 * A node's size and the vertical offset (from its top) of each of its
 * handles, as the front end draws it.
 */
export type NodeGeometry = {
	width: number;
	height: number;
	inputs: ReadonlyMap<string, number>;
	outputs: ReadonlyMap<string, number>;
};

/** What a node shows, top to bottom, for estimating its geometry. */
export type NodeRows = {
	/** Rows above the handles (settings, type picker…), the title excluded. */
	header: number;
	outputs: readonly string[];
	/** Rows taken by a widget between the outputs and the inputs. */
	widget: number;
	/** `editor`: the input shows a control under its label. */
	inputs: readonly { id: string; editor: boolean }[];
};

export type LayoutSpacing = {
	/** Horizontal gap between consecutive columns of nodes. */
	betweenLayers: number;
	/** Vertical gap between nodes of a column. */
	betweenNodes: number;
	/** Room kept around the nodes of a repeat zone, for its bubble. */
	zonePadding: number;
};

export const DEFAULT_LAYOUT_SPACING: LayoutSpacing = {
	betweenLayers: 80,
	betweenNodes: 32,
	zonePadding: 40,
};

export type LayoutInput = {
	nodes: readonly GraphNode[];
	edges: readonly GraphEdge[];
	zones: ZoneAnalysis;
	geometry: (node: GraphNode) => NodeGeometry;
	spacing?: Partial<LayoutSpacing>;
};

// Only used when the front end can't measure a node (e.g. headless): a rough
// guess from what it shows, erring on the large side.
const ESTIMATED_WIDTH = 220;
const ESTIMATED_TITLE = 40;
const ESTIMATED_ROW = 30;

export function estimateNodeGeometry(rows: NodeRows): NodeGeometry {
	let row = rows.header;
	const place = (span: number) => {
		const y = ESTIMATED_TITLE + ESTIMATED_ROW * (row + 0.5);
		row += span;
		return y;
	};
	const outputs = new Map(rows.outputs.map((id) => [id, place(1)]));
	row += rows.widget;
	const inputs = new Map(rows.inputs.map(({ id, editor }) => [id, place(editor ? 2 : 1)]));
	return {
		width: ESTIMATED_WIDTH,
		height: ESTIMATED_TITLE + ESTIMATED_ROW * Math.max(row, 1),
		inputs,
		outputs,
	};
}

const zoneKey = (zoneId: string) => `zone:${zoneId}`;
const portKey = (nodeId: string, side: "in" | "out", handleId: string) =>
	`${nodeId}:${side}:${handleId}`;

/**
 * Left-to-right layered (Sugiyama) layout of `nodes`, computed by ELK:
 * links run between handles (so crossings are minimised with the handles'
 * order), and each repeat zone is laid out as a block holding its nodes.
 * Only links between the given nodes count. Returns the new top-left corner
 * of every node, the set keeping its previous top-left corner.
 */
export async function computeLayout(input: LayoutInput): Promise<Map<string, Point>> {
	const { nodes, edges, zones } = input;
	if (nodes.length === 0) return new Map();
	const spacing = { ...DEFAULT_LAYOUT_SPACING, ...input.spacing };
	const ids = new Set(nodes.map((n) => n.id));
	const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target));

	const ports = new Map<string, ElkPort[]>();
	const addPort = (nodeId: string, port: ElkPort) => {
		const list = ports.get(nodeId) ?? [];
		if (!list.some((p) => p.id === port.id)) list.push(port);
		ports.set(nodeId, list);
	};
	const elkNodes = new Map<string, ElkNode>();
	for (const node of nodes) {
		const geometry = input.geometry(node);
		for (const [handleId, y] of geometry.inputs) {
			addPort(node.id, inputPort(node.id, handleId, y));
		}
		for (const [handleId, y] of geometry.outputs) {
			addPort(node.id, outputPort(node.id, handleId, y, geometry.width));
		}
		// Links to handles the geometry doesn't know of still get a port.
		for (const e of links) {
			if (e.target === node.id) {
				addPort(node.id, inputPort(node.id, e.targetHandle, geometry.height / 2));
			}
			if (e.source === node.id) {
				const y = geometry.height / 2;
				addPort(node.id, outputPort(node.id, e.sourceHandle, y, geometry.width));
			}
		}
		elkNodes.set(node.id, {
			id: node.id,
			width: geometry.width,
			height: geometry.height,
			ports: ports.get(node.id) ?? [],
			layoutOptions: { "elk.portConstraints": "FIXED_POS" },
		});
	}

	// A zone is a block when both its boundaries are laid out; its nodes
	// (nested zones' blocks included) go inside it.
	const blocks = new Map<string, ElkNode>();
	for (const zone of zones.zones.values()) {
		if (!ids.has(zone.inputId) || !ids.has(zone.outputId)) continue;
		const p = spacing.zonePadding;
		blocks.set(zone.id, {
			id: zoneKey(zone.id),
			children: [],
			layoutOptions: {
				"elk.padding": `[top=${String(p)},left=${String(p)},bottom=${String(p)},right=${String(p)}]`,
			},
		});
	}
	const blockOf = (nodeId: string): ElkNode | undefined => {
		let zoneId = zones.nodeZone.get(nodeId) ?? null;
		while (zoneId !== null) {
			const block = blocks.get(zoneId);
			if (block) return block;
			zoneId = zones.zones.get(zoneId)?.parent ?? null;
		}
		return undefined;
	};
	const parentBlock = (zoneId: string): ElkNode | undefined => {
		const parent = zones.zones.get(zoneId)?.parent ?? null;
		return parent === null ? undefined : blockOf(zones.zones.get(parent)?.inputId ?? "");
	};

	const root: ElkNode = { id: "root", children: [], layoutOptions: rootOptions(spacing) };
	for (const [zoneId, block] of blocks) {
		(parentBlock(zoneId) ?? root).children?.push(block);
	}
	for (const node of nodes) {
		const elkNode = elkNodes.get(node.id);
		if (elkNode) (blockOf(node.id) ?? root).children?.push(elkNode);
	}

	const elkEdges: ElkExtendedEdge[] = links.map((e) => ({
		id: e.id,
		sources: [portKey(e.source, "out", e.sourceHandle)],
		targets: [portKey(e.target, "in", e.targetHandle)],
	}));
	// Keeps a zone's input left of its output, even with nothing in between.
	for (const zoneId of blocks.keys()) {
		const zone = zones.zones.get(zoneId);
		if (!zone) continue;
		elkEdges.push({
			id: `zone-link:${zoneId}`,
			sources: [zone.inputId],
			targets: [zone.outputId],
		});
	}
	root.edges = elkEdges;

	const laidOut = await (await loadElk()).layout(root);

	const positions = new Map<string, Point>();
	const collect = (parent: ElkNode, offset: Point) => {
		for (const child of parent.children ?? []) {
			const at = { x: offset.x + (child.x ?? 0), y: offset.y + (child.y ?? 0) };
			if (ids.has(child.id)) positions.set(child.id, at);
			else collect(child, at);
		}
	};
	collect(laidOut, { x: 0, y: 0 });

	// Keep the nodes where they were: same top-left corner as before.
	const before = topLeft(nodes.map((n) => n.position));
	const after = topLeft([...positions.values()]);
	const dx = before.x - after.x;
	const dy = before.y - after.y;
	for (const [id, p] of positions) positions.set(id, { x: p.x + dx, y: p.y + dy });
	return positions;
}

let elk: ELK | undefined;

/** ELK, running in-process. Loaded on first use: it weighs over a megabyte. */
async function loadElk(): Promise<ELK> {
	if (elk) return elk;
	const { default: ElkConstructor } = await import("elkjs/lib/elk.bundled.js");
	// Its in-process worker takes a global `self` without `document` for a
	// web worker's scope (as in Bun) and then won't load: hide that while
	// it's created.
	const shim = !("document" in globalThis);
	if (shim) Object.assign(globalThis, { document: {} });
	try {
		elk = new ElkConstructor();
	} finally {
		if (shim) Reflect.deleteProperty(globalThis, "document");
	}
	return elk;
}

function inputPort(nodeId: string, handleId: string, y: number): ElkPort {
	return {
		id: portKey(nodeId, "in", handleId),
		x: 0,
		y,
		width: 0,
		height: 0,
		layoutOptions: { "elk.port.side": "WEST" },
	};
}

function outputPort(nodeId: string, handleId: string, y: number, width: number): ElkPort {
	return {
		id: portKey(nodeId, "out", handleId),
		x: width,
		y,
		width: 0,
		height: 0,
		layoutOptions: { "elk.port.side": "EAST" },
	};
}

function rootOptions(spacing: LayoutSpacing): ElkOptions {
	return {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.hierarchyHandling": "INCLUDE_CHILDREN",
		"elk.layered.spacing.nodeNodeBetweenLayers": String(spacing.betweenLayers),
		"elk.spacing.nodeNode": String(spacing.betweenNodes),
		"elk.spacing.componentComponent": String(spacing.betweenLayers),
		"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
		// Links are drawn by the front end: only node positions matter.
		"elk.edgeRouting": "POLYLINE",
	};
}

function topLeft(points: Iterable<Point>): Point {
	let x = Infinity;
	let y = Infinity;
	for (const p of points) {
		x = Math.min(x, p.x);
		y = Math.min(y, p.y);
	}
	return { x, y };
}
