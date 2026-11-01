import type {
	ELK,
	ElkExtendedEdge,
	ElkNode,
	ElkPort,
	LayoutOptions as ElkOptions,
} from "elkjs/lib/elk-api";

import {
	EMPTY_FRAME_SIZE,
	FRAME_PADDING,
	type FrameAnalysis,
	LAYOUT_FRAME,
	frameRects,
} from "../frames";
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
	frames: FrameAnalysis;
	/** A frame's geometry is that of its header (label and note). */
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

/** A frame's header as drawn, from its label and note, when it can't be measured. */
export function estimateFrameHeader(label: string, note: string | undefined): NodeGeometry {
	const lines = note ? note.split("\n") : [];
	const longest = Math.max(label.length * 9, ...lines.map((l) => l.length * 7));
	return {
		width: Math.min(longest, 480) + 24,
		height: 36 + 18 * lines.length,
		inputs: new Map(),
		outputs: new Map(),
	};
}

const zoneKey = (zoneId: string) => `zone:${zoneId}`;
const frameKey = (frameId: string) => `frame:${frameId}`;
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
		if (isFrameBlock(input.frames, node, ids)) continue;
		const geometry = emptyFrameSize(node, input.geometry(node));
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

	const blocks = layoutBlocks(input, ids, spacing);
	const root: ElkNode = { id: "root", children: [], layoutOptions: rootOptions(spacing) };
	const elkBlocks = new Map<Block, ElkNode>();
	for (const block of blocks.list) {
		elkBlocks.set(block, { id: block.key, children: [], layoutOptions: block.options });
	}
	const containerOf = (block: Block | undefined) => (block && elkBlocks.get(block)) ?? root;
	for (const block of blocks.list) {
		containerOf(blocks.parent.get(block)).children?.push(elkBlocks.get(block) ?? root);
	}
	for (const node of nodes) {
		const elkNode = elkNodes.get(node.id);
		if (elkNode) containerOf(blocks.ofNode.get(node.id)).children?.push(elkNode);
	}

	const elkEdges: ElkExtendedEdge[] = links.map((e) => ({
		id: e.id,
		sources: [portKey(e.source, "out", e.sourceHandle)],
		targets: [portKey(e.target, "in", e.targetHandle)],
	}));
	// Keeps a zone's input left of its output, even with nothing in between.
	for (const block of blocks.list) {
		const zone = block.kind === "zone" ? zones.zones.get(block.id) : undefined;
		if (!zone) continue;
		elkEdges.push({
			id: `zone-link:${zone.id}`,
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

	// Frames go where they're drawn: around what they hold, once it's moved.
	const placed = nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }));
	const sizes = new Map(nodes.map((n) => [n.id, input.geometry(n)]));
	const boxes = frameRects(
		placed,
		input.frames,
		(n) => ({ ...n.position, ...sizeOf(sizes.get(n.id)) }),
		(id) => sizeOf(sizes.get(id)),
	);
	for (const [id, box] of boxes) {
		if (ids.has(id)) positions.set(id, { x: box.x, y: box.y });
	}

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

const sizeOf = (geometry: NodeGeometry | undefined) => ({
	width: geometry?.width ?? 0,
	height: geometry?.height ?? 0,
});

/** Whether `node` is a frame holding nodes laid out: it's laid out as a block around them. */
function isFrameBlock(frames: FrameAnalysis, node: GraphNode, ids: ReadonlySet<string>): boolean {
	const frame = frames.frames.get(node.id);
	return frame !== undefined && [...frame.descendants].some((id) => ids.has(id));
}

/** An empty frame is laid out as a node of the size it's drawn at. */
function emptyFrameSize(node: GraphNode, geometry: NodeGeometry): NodeGeometry {
	if (node.type !== LAYOUT_FRAME) return geometry;
	return {
		...geometry,
		width: Math.max(geometry.width, EMPTY_FRAME_SIZE.width),
		height: geometry.height + EMPTY_FRAME_SIZE.height,
	};
}

/** A zone or a frame, laid out as a box holding its nodes. */
type Block = {
	kind: "zone" | "frame";
	id: string;
	key: string;
	/** The nodes laid out inside it, at any depth. */
	members: Set<string>;
	options: ElkOptions;
};

/**
 * The blocks to lay out: each zone with both its boundaries laid out, and
 * each frame holding nodes laid out, unless it holds part of a zone only
 * (zones decide what's in them, frames give way). Blocks nest as their
 * nodes do; a frame holding exactly a zone's nodes goes around it.
 */
function layoutBlocks(input: LayoutInput, ids: ReadonlySet<string>, spacing: LayoutSpacing) {
	const { zones, frames } = input;
	const pad = (top: number, side: number, minWidth = 0) => ({
		"elk.padding": `[top=${String(top)},left=${String(side)},bottom=${String(side)},right=${String(side)}]`,
		"elk.nodeSize.constraints": "[MINIMUM_SIZE]",
		"elk.nodeSize.minimum": `(${String(minWidth)}, 0)`,
	});

	const zoneBlocks: Block[] = [];
	for (const zone of zones.zones.values()) {
		if (!ids.has(zone.inputId) || !ids.has(zone.outputId)) continue;
		const members = new Set([zone.inputId, zone.outputId, ...zone.members]);
		const p = spacing.zonePadding;
		zoneBlocks.push({
			kind: "zone",
			id: zone.id,
			key: zoneKey(zone.id),
			members: new Set([...members].filter((id) => ids.has(id))),
			options: pad(p, p),
		});
	}
	const blockFrames = new Map(
		input.nodes.filter((n) => isFrameBlock(frames, n, ids)).map((n) => [n.id, n]),
	);
	const frameBlocks: Block[] = [];
	for (const [id, node] of blockFrames) {
		const frame = frames.frames.get(id);
		if (!frame) continue;
		const members = new Set(
			[...frame.descendants].filter((d) => ids.has(d) && !blockFrames.has(d)),
		);
		const straddles = zoneBlocks.some((z) => {
			const shared = [...z.members].filter((id) => members.has(id)).length;
			return shared > 0 && shared < z.members.size && shared < members.size;
		});
		if (straddles) continue;
		const header = sizeOf(input.geometry(node));
		frameBlocks.push({
			kind: "frame",
			id: frame.id,
			key: frameKey(frame.id),
			members,
			options: pad(FRAME_PADDING + header.height, FRAME_PADDING, header.width),
		});
	}
	const list = [...zoneBlocks, ...frameBlocks];

	const isAncestorFrame = (outer: string, inner: string) => {
		for (let up = frames.frameOf.get(inner); up !== undefined; up = frames.frameOf.get(up)) {
			if (up === outer) return true;
		}
		return false;
	};
	/** Whether `outer` goes around `inner`. */
	const holds = (outer: Block, inner: Block) => {
		if (outer === inner || [...inner.members].some((id) => !outer.members.has(id))) {
			return false;
		}
		if (inner.members.size < outer.members.size) return true;
		if (outer.kind === "frame" && inner.kind === "zone") return true;
		return outer.kind === "frame" && isAncestorFrame(outer.id, inner.id);
	};
	/** Of blocks around something, the innermost: the one all the others hold. */
	const innermost = (around: Block[]) =>
		around.find((b) => around.every((other) => other === b || holds(other, b)));

	const parent = new Map<Block, Block | undefined>(
		list.map((b) => [b, innermost(list.filter((other) => holds(other, b)))]),
	);
	const ofNode = new Map<string, Block | undefined>();
	for (const id of ids) {
		ofNode.set(id, innermost(list.filter((b) => b.members.has(id))));
	}
	return { list, parent, ofNode };
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
		// More tries at ordering each column (default 7): measured on the
		// Voronoi groups, up to a quarter fewer crossings for under half again
		// the time.
		"elk.layered.thoroughness": "30",
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
