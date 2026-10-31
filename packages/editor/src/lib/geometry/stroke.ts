import type { Point } from "./zone-geometry";

/** Where segments ab and cd cross, if they do. */
export function segmentCrossing(a: Point, b: Point, c: Point, d: Point): Point | undefined {
	const r = { x: b.x - a.x, y: b.y - a.y };
	const s = { x: d.x - c.x, y: d.y - c.y };
	const denominator = r.x * s.y - r.y * s.x;
	if (denominator === 0) return undefined;
	const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
	const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
	if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
	return { x: a.x + t * r.x, y: a.y + t * r.y };
}

type Box = { left: number; top: number; right: number; bottom: number };

function boxOf(points: readonly Point[]): Box {
	return {
		left: Math.min(...points.map((p) => p.x)),
		top: Math.min(...points.map((p) => p.y)),
		right: Math.max(...points.map((p) => p.x)),
		bottom: Math.max(...points.map((p) => p.y)),
	};
}

/** The first point, along `stroke`, where it crosses the polyline `line`. */
export function firstCrossing(stroke: readonly Point[], line: readonly Point[]): Point | undefined {
	if (stroke.length < 2 || line.length < 2) return undefined;
	const a = boxOf(stroke);
	const b = boxOf(line);
	if (a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top) {
		return undefined;
	}
	for (let i = 1; i < stroke.length; i++) {
		const [p, q] = [stroke[i - 1], stroke[i]];
		if (!p || !q) continue;
		for (let j = 1; j < line.length; j++) {
			const [c, d] = [line[j - 1], line[j]];
			if (!c || !d) continue;
			const crossing = segmentCrossing(p, q, c, d);
			if (crossing) return crossing;
		}
	}
	return undefined;
}
