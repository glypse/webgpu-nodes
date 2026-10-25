// ─── Curves ──────────────────────────────────────────────────
//
// A curve maps x to y within the 0–1 square, through control points sorted by
// x. Each pair of neighbouring points makes a cubic Bézier segment: the first
// point's right handle and the second point's left handle shape it. Before the
// first point and after the last one, the curve stays flat.

export type Vec2 = { x: number; y: number };

/**
 * How a point's handles relate:
 * - `vector`: no handles, so a segment between two vector points is straight,
 * - `free`: each handle goes its own way,
 * - `aligned`: the handles point in opposite directions, each with its length,
 * - `mirrored`: the handles point in opposite directions, with the same length.
 */
export const CURVE_POINT_KINDS = ["vector", "free", "aligned", "mirrored"] as const;
export type CurvePointKind = (typeof CURVE_POINT_KINDS)[number];

/**
 * A control point of a curve. Its handles are offsets from it: the left one
 * points left (x ≤ 0), the right one right (x ≥ 0). A vector point keeps its
 * handles for when it's given another kind, but they don't shape the curve.
 */
export type CurvePoint = Vec2 & { kind: CurvePointKind; left: Vec2; right: Vec2 };

/** A cubic Bézier segment: start, its two control points, end. */
export type CurveSegment = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * Iterations solving a segment's t for an x: Newton steps, kept within a
 * bisected bracket. Shared with the shader, so both agree.
 */
export const CURVE_SOLVE_STEPS = 16;

const ZERO: Vec2 = { x: 0, y: 0 };

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const length = (v: Vec2) => Math.hypot(v.x, v.y);
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** The handles shaping the curve around `point`. */
export function pointHandles(point: CurvePoint): { left: Vec2; right: Vec2 } {
	return point.kind === "vector" ? { left: ZERO, right: ZERO } : point;
}

/**
 * The Bézier segments between neighbouring points. Handles reaching past each
 * other in x are shortened by the same factor (as Blender does), so x only
 * grows along a segment and y stays a function of x.
 */
export function curveSegments(points: readonly CurvePoint[]): CurveSegment[] {
	const segments: CurveSegment[] = [];
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (!a || !b) continue;
		const out = pointHandles(a).right;
		const into = pointHandles(b).left;
		const reachOut = Math.max(0, out.x);
		const reachIn = Math.max(0, -into.x);
		const span = Math.max(0, b.x - a.x);
		const reach = reachOut + reachIn;
		const fac = reach > span ? span / reach : 1;
		segments.push([
			{ x: a.x, y: a.y },
			{ x: a.x + reachOut * fac, y: a.y + out.y * fac },
			{ x: b.x - reachIn * fac, y: b.y + into.y * fac },
			{ x: b.x, y: b.y },
		]);
	}
	return segments;
}

function bezier(a: number, b: number, c: number, d: number, t: number): number {
	const u = 1 - t;
	return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function bezierSlope(a: number, b: number, c: number, d: number, t: number): number {
	const u = 1 - t;
	return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c);
}

/** The parameter at which a segment reaches `x` (within its x range). */
export function segmentParameter([p0, c0, c1, p1]: CurveSegment, x: number): number {
	let low = 0;
	let high = 1;
	let t = p1.x > p0.x ? clamp((x - p0.x) / (p1.x - p0.x), 0, 1) : 0.5;
	for (let i = 0; i < CURVE_SOLVE_STEPS; i++) {
		const error = bezier(p0.x, c0.x, c1.x, p1.x, t) - x;
		if (Math.abs(error) < 1e-7) break;
		if (error < 0) low = t;
		else high = t;
		const slope = bezierSlope(p0.x, c0.x, c1.x, p1.x, t);
		const next = t - error / slope;
		t = slope > 0 && next > low && next < high ? next : (low + high) / 2;
	}
	return t;
}

/** The point of a segment at parameter `t`. */
export function segmentPoint([p0, c0, c1, p1]: CurveSegment, t: number): Vec2 {
	return {
		x: bezier(p0.x, c0.x, c1.x, p1.x, t),
		y: bezier(p0.y, c0.y, c1.y, p1.y, t),
	};
}

/** The curve's y at `x`. */
export function evaluateCurve(points: readonly CurvePoint[], x: number): number {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) return 0;
	if (x <= first.x) return first.y;
	for (const segment of curveSegments(points)) {
		if (x <= segment[3].x) return segmentPoint(segment, segmentParameter(segment, x)).y;
	}
	return last.y;
}

// ── Editing ──────────────────────────────────────────────────────────────────
//
// Edits return a new array, never mutating the given one. Points stay sorted
// by x and within the 0–1 square; handles may reach outside it.

function replaced(points: readonly CurvePoint[], index: number, point: CurvePoint): CurvePoint[] {
	return points.map((p, i) => (i === index ? point : p));
}

/**
 * `point` with its handles pointing their own way in x and following its
 * kind, the handle on side `lead` deciding the direction.
 */
function constrained(point: CurvePoint, lead: "left" | "right"): CurvePoint {
	const left = { x: Math.min(0, point.left.x), y: point.left.y };
	const right = { x: Math.max(0, point.right.x), y: point.right.y };
	const [leader, follower] = lead === "left" ? [left, right] : [right, left];
	let other = follower;
	const leaderLength = length(leader);
	if (point.kind === "aligned" && leaderLength > 0) {
		const scale = -length(follower) / leaderLength;
		other = { x: leader.x * scale, y: leader.y * scale };
	} else if (point.kind === "mirrored") {
		other = { x: -leader.x, y: -leader.y };
	}
	return lead === "left"
		? { ...point, left: leader, right: other }
		: { ...point, left: other, right: leader };
}

/**
 * Handles giving a smooth curve through `points[index]`: parallel to the line
 * between its neighbours, a third of the way to each.
 */
export function smoothHandles(
	points: readonly CurvePoint[],
	index: number,
): { left: Vec2; right: Vec2 } {
	const point = points[index];
	if (!point) return { left: ZERO, right: ZERO };
	const before = points[index - 1] ?? point;
	const after = points[index + 1] ?? point;
	const dx = after.x - before.x;
	const slope = dx > 0 ? (after.y - before.y) / dx : 0;
	const leftReach = (point.x - before.x) / 3;
	const rightReach = (after.x - point.x) / 3;
	// An end point has one neighbour: mirror the handle towards it.
	const l = leftReach || rightReach;
	const r = rightReach || leftReach;
	return { left: { x: -l, y: -l * slope }, right: { x: r, y: r * slope } };
}

/** Add a point at (`x`, `y`), smooth. Returns the curve and the point's index. */
export function addCurvePoint(
	points: readonly CurvePoint[],
	x: number,
	y: number,
): { points: CurvePoint[]; index: number } {
	const at = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
	const found = points.findIndex((p) => p.x > at.x);
	const index = found === -1 ? points.length : found;
	const added: CurvePoint = { ...at, kind: "aligned", left: ZERO, right: ZERO };
	const next = [...points.slice(0, index), added, ...points.slice(index)];
	return { points: replaced(next, index, { ...added, ...smoothHandles(next, index) }), index };
}

/**
 * Add a point on the curve at `x`, splitting its segment without changing its
 * shape: the neighbours' handles shorten, unless mirrored (their other handle
 * would have to change too). Returns the curve and the point's index.
 */
export function insertCurvePoint(
	points: readonly CurvePoint[],
	x: number,
): { points: CurvePoint[]; index: number } {
	const segments = curveSegments(points);
	const i = segments.findIndex((s) => x >= s[0].x && x <= s[3].x);
	const segment = segments[i];
	const a = points[i];
	const b = points[i + 1];
	if (!segment || !a || !b) return addCurvePoint(points, x, evaluateCurve(points, x));
	const [p0, c0, c1, p1] = segment;
	const t = segmentParameter(segment, x);
	const q0 = lerp(p0, c0, t);
	const q1 = lerp(c0, c1, t);
	const q2 = lerp(c1, p1, t);
	const r0 = lerp(q0, q1, t);
	const r1 = lerp(q1, q2, t);
	const s = lerp(r0, r1, t);
	const straight = a.kind === "vector" && b.kind === "vector";
	const added: CurvePoint = {
		x: clamp(s.x, a.x, b.x),
		y: clamp(s.y, 0, 1),
		kind: straight ? "vector" : "aligned",
		left: sub(r0, s),
		right: sub(r1, s),
	};
	const before = a.kind === "free" || a.kind === "aligned" ? { ...a, right: sub(q0, p0) } : a;
	const after = b.kind === "free" || b.kind === "aligned" ? { ...b, left: sub(q2, p1) } : b;
	return {
		points: [...points.slice(0, i), before, added, after, ...points.slice(i + 2)],
		index: i + 1,
	};
}

/** Remove a point, keeping at least two. */
export function removeCurvePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
	if (points.length <= 2) return [...points];
	return points.filter((_, i) => i !== index);
}

/** Move a point, kept between its neighbours in x and within the square. */
export function moveCurvePoint(
	points: readonly CurvePoint[],
	index: number,
	x: number,
	y: number,
): CurvePoint[] {
	const point = points[index];
	if (!point) return [...points];
	const low = points[index - 1]?.x ?? 0;
	const high = points[index + 1]?.x ?? 1;
	return replaced(points, index, { ...point, x: clamp(x, low, high), y: clamp(y, 0, 1) });
}

/** Move one of a point's handles to `offset` from it; the other follows the point's kind. */
export function moveCurveHandle(
	points: readonly CurvePoint[],
	index: number,
	side: "left" | "right",
	offset: Vec2,
): CurvePoint[] {
	const point = points[index];
	if (!point || point.kind === "vector") return [...points];
	return replaced(points, index, constrained({ ...point, [side]: offset }, side));
}

/**
 * Give a point another kind, its handles made to follow it. A point without
 * handles gets smooth ones.
 */
export function setCurvePointKind(
	points: readonly CurvePoint[],
	index: number,
	kind: CurvePointKind,
): CurvePoint[] {
	const point = points[index];
	if (!point) return [...points];
	const bare = length(point.left) === 0 && length(point.right) === 0;
	const handles = kind !== "vector" && bare ? smoothHandles(points, index) : point;
	const lead = index === points.length - 1 ? "left" : "right";
	return replaced(points, index, constrained({ ...point, ...handles, kind }, lead));
}

/** Mirror the curve left to right: x becomes 1 - x, points keep their kind. */
export function flipCurveX(points: readonly CurvePoint[]): CurvePoint[] {
	return points.toReversed().map((p) => ({
		...p,
		x: 1 - p.x,
		left: { x: -p.right.x, y: p.right.y },
		right: { x: -p.left.x, y: p.left.y },
	}));
}

/** Mirror the curve top to bottom: y becomes 1 - y. */
export function flipCurveY(points: readonly CurvePoint[]): CurvePoint[] {
	return points.map((p) => ({
		...p,
		y: 1 - p.y,
		left: { x: p.left.x, y: -p.left.y },
		right: { x: p.right.x, y: -p.right.y },
	}));
}
