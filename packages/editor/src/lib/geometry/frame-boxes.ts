import {
	analyzeFrames,
	type Box,
	estimateFrameHeader,
	type FrameAnalysis,
	frameRects,
	type GraphNode,
	type HydratedGraphDocument,
	unionOf,
	type ZoneAnalysis,
} from "$core";
import type { Node } from "@xyflow/svelte";

import { rectOf, zonePaddings } from "./node-boxes";

type Point = { x: number; y: number };

export const centerOf = (box: Box): Point => ({
	x: box.x + box.width / 2,
	y: box.y + box.height / 2,
});

const holds = (box: Box, p: Point) =>
	p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;

/**
 * Where each frame of `doc` is drawn, by id: around what it holds and the
 * bubbles of the zones it holds, under its header as SvelteFlow measured it.
 * Nodes of `loose` (being dragged) count as in no frame.
 */
export function frameBoxes(
	doc: HydratedGraphDocument,
	analysis: FrameAnalysis,
	zones: ZoneAnalysis,
	label: (frameId: string) => string,
	loose: ReadonlySet<string> = new Set(),
): Map<string, Box> {
	if (analysis.frames.size === 0) return new Map();
	const nodes = (
		loose.size === 0
			? doc.nodes
			: doc.nodes.map((n) => (loose.has(n.id) ? { ...n, frame: undefined } : n))
	) as (GraphNode & Pick<Node, "measured">)[];
	const frames = loose.size === 0 ? analysis : analyzeFrames(nodes);
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const header = (id: string) => {
		const node = byId.get(id);
		const measured = node?.measured;
		if (measured?.width !== undefined && measured.height !== undefined) {
			return { width: measured.width, height: measured.height };
		}
		return estimateFrameHeader(label(id), node?.data.note);
	};
	const paddings = zonePaddings(zones.zones);
	const bubbles = [...zones.zones.values()].flatMap((zone) => {
		const box = unionOf(
			[zone.inputId, zone.outputId, ...zone.members].flatMap((id) => {
				const node = byId.get(id);
				return node ? [rectOf(node)] : [];
			}),
		);
		const pad = paddings.get(zone.id) ?? 0;
		if (!box) return [];
		return [{ zone, box: { ...box, y: box.y - pad, height: box.height + 2 * pad } }];
	});
	return frameRects(nodes, frames, rectOf, header, (id) => {
		const inside = frames.frames.get(id)?.descendants;
		return bubbles.flatMap(({ zone, box }) =>
			inside?.has(zone.inputId) && inside.has(zone.outputId) ? [box] : [],
		);
	});
}

/** `nodes`, each frame's header moved to the top of its box. The same array when none moves. */
export function placeFrames(nodes: GraphNode[], boxes: ReadonlyMap<string, Box>): GraphNode[] {
	const placed = nodes.map((n) => {
		const box = boxes.get(n.id);
		if (!box || (box.x === n.position.x && box.y === n.position.y)) return n;
		return { ...n, position: { x: box.x, y: box.y } };
	});
	return placed.some((n, i) => n !== nodes[i]) ? placed : nodes;
}

/** The innermost frame drawn under `point`, frames of `excluded` aside. */
export function frameAt(
	boxes: ReadonlyMap<string, Box>,
	frames: FrameAnalysis,
	point: Point,
	excluded: ReadonlySet<string>,
): string | null {
	let found: { id: string; depth: number } | null = null;
	for (const [id, box] of boxes) {
		const depth = frames.frames.get(id)?.depth ?? 0;
		if (excluded.has(id) || !holds(box, point) || (found && found.depth >= depth)) continue;
		found = { id, depth };
	}
	return found?.id ?? null;
}

/** A drag of nodes, frames taking what they hold along. */
export type FrameDrag = {
	/** Where the nodes dragged were. */
	from: Map<string, Point>;
	/** What dragged frames hold, not dragged itself, from where it was. */
	inside: Map<string, Point>;
	/** Dragged frames and what they hold. */
	moving: Set<string>;
	/** Dragged nodes not in a dragged frame: the drop decides their frame. */
	loose: Set<string>;
};

export function startFrameDrag(
	doc: HydratedGraphDocument,
	frames: FrameAnalysis,
	nodeIds: readonly string[],
): FrameDrag {
	const dragged = new Set(nodeIds);
	const inside = new Map<string, Point>();
	for (const id of dragged) {
		for (const held of frames.frames.get(id)?.descendants ?? []) {
			const node = doc.nodesById.get(held);
			if (node && !dragged.has(held)) inside.set(held, node.position);
		}
	}
	const from = new Map(
		nodeIds.flatMap((id) => {
			const node = doc.nodesById.get(id);
			return node ? [[id, node.position] as const] : [];
		}),
	);
	const loose = new Set(
		nodeIds.filter((id) => {
			for (let up = frames.frameOf.get(id); up !== undefined; up = frames.frameOf.get(up)) {
				if (dragged.has(up)) return false;
			}
			return true;
		}),
	);
	return { from, inside, moving: new Set([...dragged, ...inside.keys()]), loose };
}

/**
 * The frame each node of `nodeIds` (but those in frames among them) is
 * dropped in: the innermost its center is on, frames of `moving` aside.
 * Nodes grouped by frame, null for none.
 */
export function dropTargets(
	doc: HydratedGraphDocument,
	frames: FrameAnalysis,
	boxes: ReadonlyMap<string, Box>,
	nodeIds: readonly string[],
	moving: ReadonlySet<string>,
): Map<string | null, string[]> {
	const ids = new Set(nodeIds);
	const byTarget = new Map<string | null, string[]>();
	for (const id of ids) {
		let up = frames.frameOf.get(id);
		while (up !== undefined && !ids.has(up)) up = frames.frameOf.get(up);
		const node = doc.nodesById.get(id);
		if (up !== undefined || !node) continue;
		const box = boxes.get(id) ?? rectOf(node);
		const target = frameAt(boxes, frames, centerOf(box), moving);
		byTarget.set(target, [...(byTarget.get(target) ?? []), id]);
	}
	return byTarget;
}
