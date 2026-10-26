import type { Viewport } from "../graph/document";

/**
 * Editor panels tiling a window, after Blender's screens: every area is a
 * rectangle, neighbours share edges, and the editing operations (split, join,
 * close, dock, edge moves) keep the window tiled. Coordinates are fractions
 * of the window, from its top-left corner; a value shared by several areas is
 * always the same number, so equality tells which edges coincide.
 */

export const EDITOR_TYPES = ["graph", "preview", "timeline"] as const;
export type EditorType = (typeof EDITOR_TYPES)[number];

export type GraphEditorState = {
	type: "graph";
	/** The group nodes entered, from the root down (see `GraphModel.path`). */
	path: string[];
	/** The camera on the document in view; fitted when absent. */
	viewport?: Viewport;
};

export type EditorState = GraphEditorState | { type: "preview" } | { type: "timeline" };

export type Rect = { left: number; top: number; right: number; bottom: number };

export type Area = { id: string; rect: Rect; editor: EditorState };

export type Screen = { areas: Area[] };

/** Where a neighbour lies, seen from an area. */
export type Side = "left" | "right" | "top" | "bottom";

/** Smallest area, as fractions of the window. */
export type MinSize = { width: number; height: number };

/** Tells apart floats meant to be the same coordinate from distinct ones. */
const EPSILON = 1e-9;

function same(a: number, b: number): boolean {
	return Math.abs(a - b) < EPSILON;
}

const width = (r: Rect) => r.right - r.left;
const height = (r: Rect) => r.bottom - r.top;
const horizontal = (side: Side) => side === "left" || side === "right";

export function defaultEditor(type: EditorType): EditorState {
	return type === "graph" ? { type, path: [] } : { type };
}

/** A copy of an editor's state, sharing nothing with it. */
function cloneEditor(editor: EditorState): EditorState {
	if (editor.type !== "graph") return { ...editor };
	return {
		type: "graph",
		path: [...editor.path],
		...(editor.viewport ? { viewport: { ...editor.viewport } } : {}),
	};
}

export function defaultScreen(): Screen {
	return {
		areas: [
			{
				id: "preview",
				rect: { left: 0, top: 0, right: 0.3, bottom: 0.92 },
				editor: defaultEditor("preview"),
			},
			{
				id: "graph",
				rect: { left: 0.3, top: 0, right: 1, bottom: 0.92 },
				editor: defaultEditor("graph"),
			},
			{
				id: "timeline",
				rect: { left: 0, top: 0.92, right: 1, bottom: 1 },
				editor: defaultEditor("timeline"),
			},
		],
	};
}

export function findArea(screen: Screen, id: string): Area | undefined {
	return screen.areas.find((a) => a.id === id);
}

/** The area containing a point (window fractions). */
export function areaAt(screen: Screen, x: number, y: number): Area | undefined {
	return screen.areas.find(
		(a) => x >= a.rect.left && x <= a.rect.right && y >= a.rect.top && y <= a.rect.bottom,
	);
}

function replaceAreas(screen: Screen, changed: readonly Area[], removed: readonly string[] = []) {
	const byId = new Map(changed.map((a) => [a.id, a]));
	const kept = screen.areas
		.filter((a) => !removed.includes(a.id))
		.map((a) => byId.get(a.id) ?? a);
	const added = changed.filter((a) => !screen.areas.some((b) => b.id === a.id));
	return { areas: [...kept, ...added] };
}

export function setAreaEditor(screen: Screen, id: string, editor: EditorState): Screen {
	const area = findArea(screen, id);
	return area ? replaceAreas(screen, [{ ...area, editor }]) : screen;
}

/** Exchange two areas' editors, as Blender's Ctrl-drag from a corner does. */
export function swapAreas(screen: Screen, a: string, b: string): Screen {
	const first = findArea(screen, a);
	const second = findArea(screen, b);
	if (!first || !second || a === b) return screen;
	return replaceAreas(screen, [
		{ ...first, editor: second.editor },
		{ ...second, editor: first.editor },
	]);
}

// ── Split ────────────────────────────────────────────────────────────────────

/**
 * Split an area along `axis` ("x": a vertical line at x = `at`, "y": a
 * horizontal one at y = `at`). The new area, a copy of the editor, takes the
 * part on `newSide` of the line. Undefined when the parts would be smaller
 * than `min`.
 */
export function splitArea(
	screen: Screen,
	id: string,
	axis: "x" | "y",
	at: number,
	newId: string,
	newSide: "before" | "after",
	min: MinSize = { width: 0, height: 0 },
): Screen | undefined {
	const area = findArea(screen, id);
	if (!area) return undefined;
	const { rect } = area;
	const [start, end, size] =
		axis === "x" ? [rect.left, rect.right, min.width] : [rect.top, rect.bottom, min.height];
	if (at - start < size || end - at < size || at <= start || at >= end) return undefined;
	const before: Rect = axis === "x" ? { ...rect, right: at } : { ...rect, bottom: at };
	const after: Rect = axis === "x" ? { ...rect, left: at } : { ...rect, top: at };
	const created: Area = {
		id: newId,
		rect: newSide === "before" ? before : after,
		editor: cloneEditor(area.editor),
	};
	const kept: Area = { ...area, rect: newSide === "before" ? after : before };
	return replaceAreas(screen, [kept, created]);
}

// ── Join ─────────────────────────────────────────────────────────────────────

/**
 * The side of `a` that `b` lies against, when they share an edge over at
 * least `tolerance` (or all of the shorter one's).
 */
export function neighbourSide(a: Area, b: Area, tolerance: MinSize): Side | undefined {
	if (a.id === b.id) return undefined;
	const ra = a.rect;
	const rb = b.rect;
	const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
	const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
	const minX = Math.min(tolerance.width, width(ra), width(rb)) - EPSILON;
	const minY = Math.min(tolerance.height, height(ra), height(rb)) - EPSILON;
	if (same(ra.top, rb.bottom) && overlapX >= minX) return "top";
	if (same(ra.bottom, rb.top) && overlapX >= minX) return "bottom";
	if (same(ra.left, rb.right) && overlapY >= minY) return "left";
	if (same(ra.right, rb.left) && overlapY >= minY) return "right";
	return undefined;
}

/** Where the shared edge's ends differ: `b`'s start and end minus `a`'s, along the edge. */
function offsets(a: Rect, b: Rect, side: Side): [number, number] {
	return horizontal(side)
		? [b.top - a.top, b.bottom - a.bottom]
		: [b.left - a.left, b.right - a.right];
}

/** Move every coordinate equal to `from` on `axis` to `to`, keeping edges shared. */
function moveLine(screen: Screen, axis: "x" | "y", from: number, to: number): Screen {
	const [lo, hi] = axis === "x" ? (["left", "right"] as const) : (["top", "bottom"] as const);
	return {
		areas: screen.areas.map((a) => {
			const rect = { ...a.rect };
			if (same(rect[lo], from)) rect[lo] = to;
			if (same(rect[hi], from)) rect[hi] = to;
			return { ...a, rect };
		}),
	};
}

function isTiled(screen: Screen): boolean {
	return screen.areas.every((a) => width(a.rect) > EPSILON && height(a.rect) > EPSILON);
}

/**
 * Line up two neighbours' ends by moving the edges at them (and every edge
 * sharing their coordinates) to their average, when they differ by less than
 * the tolerance.
 */
function alignNeighbours(
	screen: Screen,
	aId: string,
	bId: string,
	side: Side,
	tolerance: MinSize,
): Screen | undefined {
	const a = findArea(screen, aId);
	const b = findArea(screen, bId);
	if (!a || !b) return undefined;
	const limit = horizontal(side) ? tolerance.height : tolerance.width;
	const [offset1, offset2] = offsets(a.rect, b.rect, side);
	if (Math.abs(offset1) >= limit || Math.abs(offset2) >= limit) return undefined;
	const axis = horizontal(side) ? "y" : "x";
	const [lo, hi] = horizontal(side) ? (["top", "bottom"] as const) : (["left", "right"] as const);
	const start = (a.rect[lo] + b.rect[lo]) / 2;
	const end = (a.rect[hi] + b.rect[hi]) / 2;
	let next = moveLine(screen, axis, a.rect[lo], start);
	next = moveLine(next, axis, b.rect[lo], start);
	next = moveLine(next, axis, a.rect[hi], end);
	next = moveLine(next, axis, b.rect[hi], end);
	return isTiled(next) ? next : undefined;
}

/** `keep` grows over `remove`, which goes; their shared edge must span both. */
function joinAligned(screen: Screen, keepId: string, removeId: string, tolerance: MinSize) {
	const keep = findArea(screen, keepId);
	const remove = findArea(screen, removeId);
	if (!keep || !remove) return undefined;
	const side = neighbourSide(keep, remove, tolerance);
	if (!side) return undefined;
	const aligned = alignNeighbours(screen, keepId, removeId, side, tolerance);
	if (!aligned) return undefined;
	const k = findArea(aligned, keepId);
	const r = findArea(aligned, removeId);
	if (!k || !r) return undefined;
	const rect: Rect = {
		left: Math.min(k.rect.left, r.rect.left),
		top: Math.min(k.rect.top, r.rect.top),
		right: Math.max(k.rect.right, r.rect.right),
		bottom: Math.max(k.rect.bottom, r.rect.bottom),
	};
	return replaceAreas(aligned, [{ ...k, rect }], [removeId]);
}

/**
 * Cut off the part of an area past `at` along the shared edge, as a new area
 * keeping its editor. `end` picks the far (right / bottom) part over the near one.
 */
function trim(
	screen: Screen,
	id: string,
	side: Side,
	at: number,
	end: boolean,
	createId: () => string,
): { screen: Screen; piece: string } | undefined {
	const newId = createId();
	const axis = horizontal(side) ? "y" : "x";
	const next = splitArea(screen, id, axis, at, newId, end ? "after" : "before");
	return next ? { screen: next, piece: newId } : undefined;
}

/**
 * `keep` grows over its neighbour `remove`, which goes. Where their shared edge
 * doesn't span both, the overhang is cut off first: a cut-off part of `remove`
 * stays as an area of its own; one of `keep` is closed (its neighbours take its
 * space), as are all cut-off parts with `closeRemainders`. Ends closer than the
 * tolerance are lined up instead.
 */
export function joinAreas(
	screen: Screen,
	keepId: string,
	removeId: string,
	tolerance: MinSize,
	createId: () => string,
	{ closeRemainders = false }: { closeRemainders?: boolean } = {},
): Screen | undefined {
	const keep = findArea(screen, keepId);
	const remove = findArea(screen, removeId);
	if (!keep || !remove) return undefined;
	const side = neighbourSide(keep, remove, tolerance);
	if (!side) return undefined;
	const limit = horizontal(side) ? tolerance.height : tolerance.width;
	const [offset1, offset2] = offsets(keep.rect, remove.rect, side);
	const [lo, hi] = horizontal(side) ? (["top", "bottom"] as const) : (["left", "right"] as const);

	let next = screen;
	const keepPieces: string[] = [];
	const removePieces: string[] = [];
	// Overhang at the start: the one starting first is cut where the other starts.
	if (Math.abs(offset1) >= limit) {
		const cutKeep = offset1 > 0;
		const target = cutKeep ? keepId : removeId;
		const at = cutKeep ? remove.rect[lo] : keep.rect[lo];
		const cut = trim(next, target, side, at, false, createId);
		if (!cut) return undefined;
		next = cut.screen;
		// The cut-off piece took the new id; the original keeps the far part.
		(cutKeep ? keepPieces : removePieces).push(cut.piece);
	}
	// Overhang at the end: the one ending last is cut where the other ends.
	if (Math.abs(offset2) >= limit) {
		const cutKeep = offset2 < 0;
		const target = cutKeep ? keepId : removeId;
		const at = cutKeep ? remove.rect[hi] : keep.rect[hi];
		const cut = trim(next, target, side, at, true, createId);
		if (!cut) return undefined;
		next = cut.screen;
		(cutKeep ? keepPieces : removePieces).push(cut.piece);
	}

	const joined = joinAligned(next, keepId, removeId, tolerance);
	if (!joined) return undefined;
	next = joined;
	const closing = closeRemainders ? [...keepPieces, ...removePieces] : keepPieces;
	for (const piece of closing) {
		next = closeArea(next, piece, tolerance, createId, keepId) ?? next;
	}
	return next;
}

/**
 * Remove an area, a neighbour growing over it: the one sharing the most of
 * its edge (relative to the longer of the two), never `except`.
 */
export function closeArea(
	screen: Screen,
	id: string,
	tolerance: MinSize,
	createId: () => string,
	except?: string,
): Screen | undefined {
	const area = findArea(screen, id);
	if (!area || screen.areas.length < 2) return undefined;
	let best: { id: string; alignment: number } | undefined;
	for (const neighbour of screen.areas) {
		if (neighbour.id === id || neighbour.id === except) continue;
		const side = neighbourSide(area, neighbour, tolerance);
		if (!side) continue;
		const length = horizontal(side) ? height : width;
		const a = length(area.rect);
		const b = length(neighbour.rect);
		const alignment = Math.min(a, b) / Math.max(a, b);
		if (!best || alignment > best.alignment) best = { id: neighbour.id, alignment };
	}
	if (!best) return undefined;
	return joinAreas(screen, best.id, id, tolerance, createId, { closeRemainders: true });
}

// ── Dock ─────────────────────────────────────────────────────────────────────

export type DockTarget = Side | "center";

/**
 * Move `source`'s editor into `target`: into a new part of it on `where`
 * (`factor` of its size), or in its place for "center"; `source` closes.
 */
export function dockArea(
	screen: Screen,
	sourceId: string,
	targetId: string,
	where: DockTarget,
	factor: number,
	tolerance: MinSize,
	createId: () => string,
): Screen | undefined {
	const source = findArea(screen, sourceId);
	const target = findArea(screen, targetId);
	if (!source || !target || sourceId === targetId) return undefined;
	let next = screen;
	let slot = targetId;
	if (where !== "center") {
		const { rect } = target;
		const axis = horizontal(where) ? "x" : "y";
		const at =
			where === "left"
				? rect.left + width(rect) * factor
				: where === "right"
					? rect.right - width(rect) * factor
					: where === "top"
						? rect.top + height(rect) * factor
						: rect.bottom - height(rect) * factor;
		slot = createId();
		const before = where === "left" || where === "top";
		const split = splitArea(
			next,
			targetId,
			axis,
			at,
			slot,
			before ? "before" : "after",
			tolerance,
		);
		if (!split) return undefined;
		next = split;
	}
	next = setAreaEditor(next, slot, cloneEditor(source.editor));
	return (
		closeArea(next, sourceId, tolerance, createId, slot) ??
		closeArea(next, sourceId, tolerance, createId)
	);
}

// ── Edges ────────────────────────────────────────────────────────────────────

/** An area's side lying on an edge being moved. */
export type EdgeSide = { area: string; side: Side };

/** A set of area sides on one line, moved together. */
export type EdgeSelection = { axis: "x" | "y"; position: number; sides: EdgeSide[] };

const SIDE_KEYS = {
	left: "left",
	right: "right",
	top: "top",
	bottom: "bottom",
} as const satisfies Record<Side, keyof Rect>;

/** The sides of areas lying on the line at `position` (not the window's border). */
function sidesOnLine(screen: Screen, axis: "x" | "y", position: number) {
	const sides: (EdgeSide & { start: number; end: number })[] = [];
	if (same(position, 0) || same(position, 1)) return sides;
	for (const a of screen.areas) {
		const candidates: Side[] = axis === "x" ? ["left", "right"] : ["top", "bottom"];
		for (const side of candidates) {
			if (!same(a.rect[SIDE_KEYS[side]], position)) continue;
			const [start, end] =
				axis === "x" ? [a.rect.top, a.rect.bottom] : [a.rect.left, a.rect.right];
			sides.push({ area: a.id, side, start, end });
		}
	}
	return sides;
}

/**
 * The interior edge within `threshold` of a point, as Blender picks it: the
 * sides on that line connected to the one under the point (through
 * T-junctions), or every side on it with `extend`.
 */
export function edgeAt(
	screen: Screen,
	x: number,
	y: number,
	threshold: MinSize,
	{ extend = false }: { extend?: boolean } = {},
): EdgeSelection | undefined {
	for (const area of screen.areas) {
		const { rect } = area;
		const lines: ["x" | "y", number, number, number, number][] = [
			["x", rect.left, x, rect.top, rect.bottom],
			["x", rect.right, x, rect.top, rect.bottom],
			["y", rect.top, y, rect.left, rect.right],
			["y", rect.bottom, y, rect.left, rect.right],
		];
		for (const [axis, position, pointer, start, end] of lines) {
			const along = axis === "x" ? y : x;
			const near = axis === "x" ? threshold.width : threshold.height;
			if (Math.abs(pointer - position) > near || along < start || along > end) continue;
			const sides = sidesOnLine(screen, axis, position);
			if (sides.length === 0) continue;
			if (extend)
				return {
					axis,
					position,
					sides: sides.map(({ area: a, side }) => ({ area: a, side })),
				};
			let lo = start;
			let hi = end;
			const picked = new Set<number>();
			let grew = true;
			while (grew) {
				grew = false;
				sides.forEach((s, i) => {
					if (picked.has(i) || s.end < lo - EPSILON || s.start > hi + EPSILON) return;
					picked.add(i);
					lo = Math.min(lo, s.start);
					hi = Math.max(hi, s.end);
					grew = true;
				});
			}
			const selected = [...picked].map((i) => sides[i]).filter((s) => s !== undefined);
			return {
				axis,
				position,
				sides: selected.map(({ area: a, side }) => ({ area: a, side })),
			};
		}
	}
	return undefined;
}

/** How far an edge can move, keeping every area it bounds at least `min`. */
export function edgeLimits(screen: Screen, edge: EdgeSelection, min: MinSize): [number, number] {
	let lo = 0;
	let hi = 1;
	const size = edge.axis === "x" ? min.width : min.height;
	for (const { area: id, side } of edge.sides) {
		const area = findArea(screen, id);
		if (!area) continue;
		const { rect } = area;
		if (side === "right") lo = Math.max(lo, rect.left + size);
		if (side === "left") hi = Math.min(hi, rect.right - size);
		if (side === "bottom") lo = Math.max(lo, rect.top + size);
		if (side === "top") hi = Math.min(hi, rect.bottom - size);
	}
	return [lo, hi];
}

/** Move an edge to `position`, clamped to its limits. */
export function moveEdge(
	screen: Screen,
	edge: EdgeSelection,
	position: number,
	min: MinSize,
): Screen {
	const [lo, hi] = edgeLimits(screen, edge, min);
	if (lo > hi) return screen;
	const to = Math.min(hi, Math.max(lo, position));
	const moved = new Map<string, Area>();
	for (const { area: id, side } of edge.sides) {
		const area = moved.get(id) ?? findArea(screen, id);
		if (!area) continue;
		moved.set(id, { ...area, rect: { ...area.rect, [SIDE_KEYS[side]]: to } });
	}
	return replaceAreas(screen, [...moved.values()]);
}
