// ── Zone bubble geometry ─────────────────────────────────────────────────────
//
// A zone is drawn as a rounded convex "bubble" around its nodes: the convex
// hull of the nodes' rectangles, grown outward by a padding radius (the
// Minkowski sum of the hull with a disc), which rounds every corner.

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

const ORIGIN: Point = { x: 0, y: 0 };

/** Cyclic access: `at(points, -1)` is the last point. */
function at(points: readonly Point[], index: number): Point {
	const n = points.length;
	return points[((index % n) + n) % n] ?? ORIGIN;
}

function cross(o: Point, a: Point, b: Point): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** One monotone chain: keeps only left turns while walking `sorted`. */
function chain(sorted: readonly Point[]): Point[] {
	const out: Point[] = [];
	for (const p of sorted) {
		while (out.length >= 2 && cross(at(out, -2), at(out, -1), p) <= 0) out.pop();
		out.push(p);
	}
	out.pop();
	return out;
}

/** Convex hull (Andrew's monotone chain), without collinear points. */
export function convexHull(points: readonly Point[]): Point[] {
	const sorted = [...points].toSorted((a, b) => a.x - b.x || a.y - b.y);
	if (sorted.length <= 2) return sorted;
	return [...chain(sorted), ...chain(sorted.toReversed())];
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * SVG path of a convex polygon grown by `radius`: straight edges pushed
 * outward, joined by arcs centred on the original vertices.
 */
export function roundedHullPath(hull: readonly Point[], radius: number): string {
	const first = hull[0];
	if (!first) return "";
	const r = fmt(radius);
	if (hull.length === 1) {
		const d = fmt(radius * 2);
		return `M ${fmt(first.x - radius)} ${fmt(first.y)} a ${r} ${r} 0 1 0 ${d} 0 a ${r} ${r} 0 1 0 -${d} 0 Z`;
	}

	// Orientation in screen space (y down): positive = clockwise on screen.
	let area = 0;
	for (let i = 0; i < hull.length; i++) {
		const a = at(hull, i);
		const b = at(hull, i + 1);
		area += a.x * b.y - b.x * a.y;
	}
	const clockwise = area > 0;

	/** Outward unit normal of the edge leaving vertex `i`. */
	const normal = (i: number): Point => {
		const a = at(hull, i);
		const b = at(hull, i + 1);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		return clockwise ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
	};
	const offset = (p: Point, n: Point) => `${fmt(p.x + n.x * radius)} ${fmt(p.y + n.y * radius)}`;

	const sweep = clockwise ? "1" : "0";
	const parts = [`M ${offset(first, normal(0))}`];
	for (let i = 0; i < hull.length; i++) {
		const next = at(hull, i + 1);
		parts.push(`L ${offset(next, normal(i))}`);
		parts.push(`A ${r} ${r} 0 0 ${sweep} ${offset(next, normal(i + 1))}`);
	}
	parts.push("Z");
	return parts.join(" ");
}

/**
 * The bubble path enclosing `rects` and `points`, `padding` away from them,
 * with corners rounded by `cornerRadius` (at most `padding`): shapes are first
 * grown by `padding - cornerRadius` with square corners, and the hull of that
 * is grown by the remaining `cornerRadius`.
 */
export function bubblePath(
	rects: readonly Rect[],
	padding: number,
	points: readonly Point[] = [],
	cornerRadius = padding,
): string {
	const radius = Math.max(0, Math.min(cornerRadius, padding));
	const grow = padding - radius;
	const corners = [
		...rects,
		...points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })),
	].flatMap((r) => [
		{ x: r.x - grow, y: r.y - grow },
		{ x: r.x + r.width + grow, y: r.y - grow },
		{ x: r.x + r.width + grow, y: r.y + r.height + grow },
		{ x: r.x - grow, y: r.y + r.height + grow },
	]);
	return roundedHullPath(convexHull(corners), radius);
}

/**
 * Points making a zone's outline cut through the middle of its boundary nodes
 * (like Blender): for each node, a vertical segment spanning its height,
 * `padding` inward from its centre line, so that once the hull is grown by
 * `padding` its edge lands on that centre line. "Inward" is towards the
 * other boundary node.
 */
export function boundaryPoints(input: Rect, output: Rect, padding: number): Point[] {
	const inCenter = input.x + input.width / 2;
	const outCenter = output.x + output.width / 2;
	const inward = Math.sign(outCenter - inCenter) || 1;
	const segment = (r: Rect, x: number): Point[] => [
		{ x, y: r.y },
		{ x, y: r.y + r.height },
	];
	return [
		...segment(input, inCenter + inward * padding),
		...segment(output, outCenter - inward * padding),
	];
}
