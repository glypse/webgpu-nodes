import type { FrameAnalysis } from "./analysis";

export type Box = { x: number; y: number; width: number; height: number };

/** Distance between a frame's border and what it holds. */
export const FRAME_PADDING = 24;

/** Room an empty frame keeps under its header, to drop nodes in. */
export const EMPTY_FRAME_SIZE = { width: 240, height: 120 };

type PlacedNode = { id: string; position: { x: number; y: number } };

/**
 * The box of every frame: around what it holds (nested frames' boxes
 * included) and the boxes `around` gives it, its header (label and note) on
 * top. An empty frame keeps its own position. `header` is the size its
 * header is drawn at.
 */
export function frameRects<N extends PlacedNode>(
	nodes: readonly N[],
	analysis: FrameAnalysis,
	rectOf: (node: N) => Box,
	header: (frameId: string) => { width: number; height: number },
	around: (frameId: string) => readonly Box[] = () => [],
): Map<string, Box> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const rects = new Map<string, Box>();
	const deepestFirst = [...analysis.frames.values()].toSorted((a, b) => b.depth - a.depth);
	for (const frame of deepestFirst) {
		const node = byId.get(frame.id);
		if (!node) continue;
		const head = header(frame.id);
		const inner = frame.children.flatMap((id) => {
			const child = byId.get(id);
			if (!child) return [];
			return [rects.get(id) ?? rectOf(child)];
		});
		inner.push(...around(frame.id));
		const bounds = unionOf(inner);
		if (!bounds) {
			rects.set(frame.id, {
				...node.position,
				width: Math.max(head.width, EMPTY_FRAME_SIZE.width),
				height: head.height + EMPTY_FRAME_SIZE.height,
			});
			continue;
		}
		rects.set(frame.id, {
			x: bounds.x - FRAME_PADDING,
			y: bounds.y - FRAME_PADDING - head.height,
			width: Math.max(bounds.width + 2 * FRAME_PADDING, head.width),
			height: bounds.height + 2 * FRAME_PADDING + head.height,
		});
	}
	return rects;
}

export function unionOf(rects: readonly Box[]): Box | undefined {
	if (rects.length === 0) return undefined;
	const left = Math.min(...rects.map((r) => r.x));
	const top = Math.min(...rects.map((r) => r.y));
	const right = Math.max(...rects.map((r) => r.x + r.width));
	const bottom = Math.max(...rects.map((r) => r.y + r.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}
