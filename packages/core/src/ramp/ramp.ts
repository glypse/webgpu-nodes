// ─── Colour ramps ────────────────────────────────────────────
//
// A ramp maps a factor to a colour through stops, each a position in [0, 1]
// and a colour. Past its first and last stops, a ramp keeps their colours.
// Between two stops, colours are interpolated in a colour space: RGB (linear),
// HSV (of the sRGB-encoded colour, as Blender's) or OKLch, their hues taking
// the way around the circle a hue interpolation picks.
//
// The interpolations are Blender's (Linear, Ease, Cardinal, B-Spline,
// Constant) and Smooth: a monotone cubic (Steffen's), which is smooth through
// every stop without overshooting, and follows their spacing. Blender's other
// curves ignore it, as each segment is uniformly parameterised.
//
// `evaluateRamp` is the shader's computation on the CPU, stage by stage: the
// two must change together.

import { decodeRgb, encodeRgb, linearToOklch, oklchToLinearUnmapped } from "../color/convert";
import type { EnumVariant } from "../types/descriptors";

export type RampStop = { id: string; position: number };

/** Four components: a colour's three in a ramp's space, then alpha. */
export type Vec4 = readonly [number, number, number, number];

export const RAMP_LINEAR = 0;
export const RAMP_EASE = 1;
export const RAMP_SMOOTH = 2;
export const RAMP_CARDINAL = 3;
export const RAMP_B_SPLINE = 4;
export const RAMP_CONSTANT = 5;

export const RAMP_INTERPOLATIONS: readonly EnumVariant[] = [
	{ value: RAMP_LINEAR, label: "Linear" },
	{ value: RAMP_EASE, label: "Ease" },
	{ value: RAMP_SMOOTH, label: "Smooth" },
	{ value: RAMP_CARDINAL, label: "Cardinal" },
	{ value: RAMP_B_SPLINE, label: "B-Spline" },
	{ value: RAMP_CONSTANT, label: "Constant" },
];

export const RAMP_RGB = 0;
export const RAMP_HSV = 1;
export const RAMP_OKLCH = 2;

export const RAMP_SPACES: readonly EnumVariant[] = [
	{ value: RAMP_RGB, label: "RGB" },
	{ value: RAMP_HSV, label: "HSV" },
	{ value: RAMP_OKLCH, label: "OKLch" },
];

export const HUE_SHORTER = 0;
export const HUE_LONGER = 1;
export const HUE_INCREASING = 2;
export const HUE_DECREASING = 3;

/** CSS Color 4's names: Blender calls them Near, Far, Counter-Clockwise and Clockwise. */
export const RAMP_HUES: readonly EnumVariant[] = [
	{ value: HUE_SHORTER, label: "Shorter" },
	{ value: HUE_LONGER, label: "Longer" },
	{ value: HUE_INCREASING, label: "Increasing" },
	{ value: HUE_DECREASING, label: "Decreasing" },
];

/** Below this saturation (HSV) or chroma (OKLch), a colour's hue doesn't show. */
export const RAMP_ACHROMATIC = 1e-4;

/** Blender's cardinal spline tension. */
export const RAMP_CARDINAL_TENSION = 0.71;

const STOP_PREFIX = "stop-";

export function isRampStopId(id: string): boolean {
	return /^stop-\d{1,9}$/.test(id);
}

/** Black to white, as Blender's. */
export const DEFAULT_RAMP: readonly RampStop[] = [
	{ id: `${STOP_PREFIX}0`, position: 0 },
	{ id: `${STOP_PREFIX}1`, position: 1 },
];

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

/**
 * A ramp's stops as its node holds them: sorted by position (equal ones
 * keeping their order) within [0, 1], ids unique; the default ramp if none.
 */
export function sortedRampStops(stops: readonly RampStop[] | undefined): RampStop[] {
	const seen = new Set<string>();
	const kept = (stops ?? []).filter((s) => {
		if (!isRampStopId(s.id) || seen.has(s.id)) return false;
		seen.add(s.id);
		return true;
	});
	if (kept.length === 0) return [...DEFAULT_RAMP];
	return kept
		.map((s) => ({ id: s.id, position: clamp01(s.position) }))
		.sort((a, b) => a.position - b.position);
}

/** An id none of `stops` has. */
function freeStopId(stops: readonly RampStop[]): string {
	const taken = new Set(stops.map((s) => s.id));
	let n = 0;
	while (taken.has(`${STOP_PREFIX}${String(n)}`)) n++;
	return `${STOP_PREFIX}${String(n)}`;
}

// ── Editing ──────────────────────────────────────────────────────────────────
//
// Edits return new, sorted arrays, never mutating the given one.

/** Add a stop at `position`; returns the ramp and the stop. */
export function addRampStop(
	stops: readonly RampStop[],
	position: number,
): { stops: RampStop[]; stop: RampStop } {
	const stop = { id: freeStopId(stops), position: clamp01(position) };
	return { stops: sortedRampStops([...stops, stop]), stop };
}

/**
 * Where Blender adds a stop: halfway between the selected one and the next
 * (or the previous, for the last), or in the middle without one.
 */
export function newStopPosition(stops: readonly RampStop[], selected: string | undefined): number {
	const index = stops.findIndex((s) => s.id === selected);
	const at = stops[index];
	if (!at) return 0.5;
	const neighbour = stops[index + 1] ?? stops[index - 1];
	return neighbour ? (at.position + neighbour.position) / 2 : at.position < 0.5 ? 1 : 0;
}

/** Remove a stop, keeping at least one. */
export function removeRampStop(stops: readonly RampStop[], id: string): RampStop[] {
	if (stops.length <= 1) return [...stops];
	return stops.filter((s) => s.id !== id);
}

/** Move a stop, which may pass others: they swap places, as in Blender. */
export function moveRampStop(stops: readonly RampStop[], id: string, position: number): RampStop[] {
	const moved = stops.map((s) => (s.id === id ? { ...s, position: clamp01(position) } : s));
	return sortedRampStops(moved);
}

/** Mirror the ramp: positions become 1 - position. */
export function flipRamp(stops: readonly RampStop[]): RampStop[] {
	return sortedRampStops(stops.toReversed().map((s) => ({ ...s, position: 1 - s.position })));
}

/** Space the stops evenly from 0 to 1, in their order. */
export function distributeRamp(stops: readonly RampStop[]): RampStop[] {
	const last = Math.max(1, stops.length - 1);
	return stops.map((s, i) => ({ ...s, position: stops.length === 1 ? 0.5 : i / last }));
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/** What a ramp's enum inputs pick, by variant value. */
export type RampModes = { interpolation: number; space: number; hue: number };

/** A stop with its colour: linear RGB and alpha. */
export type RampColorStop = { position: number; color: Vec4 };

const fract = (n: number) => n - Math.floor(n);
const add = (a: Vec4, b: Vec4): Vec4 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
const sub = (a: Vec4, b: Vec4): Vec4 => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
const scale = (a: Vec4, k: number): Vec4 => [a[0] * k, a[1] * k, a[2] * k, a[3] * k];
const each = (a: Vec4, f: (n: number, i: number) => number): Vec4 => [
	f(a[0], 0),
	f(a[1], 1),
	f(a[2], 2),
	f(a[3], 3),
];
const mix = (a: Vec4, b: Vec4, t: number): Vec4 => add(a, scale(sub(b, a), t));
const weighted = (points: readonly Vec4[], weights: readonly number[]): Vec4 =>
	points.reduce<Vec4>((sum, p, i) => add(sum, scale(p, weights[i] ?? 0)), [0, 0, 0, 0]);

/** HSV of an sRGB-encoded colour, unclamped above (HDR); hue in turns. */
function rgbToHsv([r, g, b]: readonly number[]): [number, number, number] {
	const [cr = 0, cg = 0, cb = 0] = [r, g, b];
	const max = Math.max(cr, cg, cb);
	const delta = max - Math.min(cr, cg, cb);
	let h = 0;
	if (delta > 0) {
		if (max === cr) h = (cg - cb) / delta + (cg < cb ? 6 : 0);
		else if (max === cg) h = (cb - cr) / delta + 2;
		else h = (cr - cg) / delta + 4;
	}
	return [h / 6, max > 0 ? delta / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const sector = fract(h) * 6;
	const channel = (n: number) => {
		const k = (n + sector) % 6;
		return v - v * s * clamp01(Math.min(k, 4 - k));
	};
	return [channel(5), channel(3), channel(1)];
}

/** A colour in `space`, polar ones hue first (in turns). */
export function rampToSpace(color: Vec4, space: number): Vec4 {
	const [r, g, b, a] = color;
	if (space === RAMP_HSV) {
		const encoded = encodeRgb({ r, g, b });
		const [h, s, v] = rgbToHsv([encoded.r, encoded.g, encoded.b]);
		return [h, s, v, a];
	}
	if (space === RAMP_OKLCH) {
		const { l, c, h } = linearToOklch({ r, g, b });
		return [fract(h / 360), c, l, a];
	}
	return color;
}

/** The linear RGB of a colour in `space`, saturation, chroma, value and lightness kept in range. */
export function rampFromSpace(color: Vec4, space: number): Vec4 {
	const [x, y, z, a] = color;
	if (space === RAMP_HSV) {
		const [r, g, b] = hsvToRgb(x, clamp01(y), Math.max(0, z));
		const { r: lr, g: lg, b: lb } = decodeRgb({ r, g, b });
		return [lr, lg, lb, a];
	}
	if (space === RAMP_OKLCH) {
		const { r, g, b } = oklchToLinearUnmapped({
			l: Math.max(0, z),
			c: Math.max(0, y),
			h: fract(x) * 360,
		});
		return [r, g, b, a];
	}
	return color;
}

/** How far a hue goes (in turns) from `from` to `to`, the way `mode` picks. */
export function hueDelta(from: number, to: number, mode: number): number {
	const d = fract(to - from);
	switch (mode) {
		case HUE_LONGER:
			return d < 0.5 ? d - 1 : d;
		case HUE_INCREASING:
			return d;
		case HUE_DECREASING:
			return d === 0 ? 0 : d - 1;
		default:
			return d > 0.5 ? d - 1 : d;
	}
}

/**
 * The hues of four neighbouring stops unwrapped along the ramp, each going
 * from the one before the way `mode` picks. An achromatic stop takes the
 * hue of its nearest colourful neighbour (as CSS's powerless hues), so that
 * greys, whose hue is noise, don't add hues of their own.
 */
function unwrapHues(q: [Vec4, Vec4, Vec4, Vec4], mode: number): [Vec4, Vec4, Vec4, Vec4] {
	const grey = q.map((c) => c[1] < RAMP_ACHROMATIC);
	const hue = (i: number) => q[i]?.[0] ?? 0;
	const h1 = !grey[1] ? hue(1) : !grey[2] ? hue(2) : !grey[0] ? hue(0) : hue(3);
	const h2 = h1 + (grey[1] || grey[2] ? 0 : hueDelta(hue(1), hue(2), mode));
	const h0 = grey[0] ? h1 : h1 - hueDelta(hue(0), h1, grey[1] ? HUE_SHORTER : mode);
	const h3 = grey[3] ? h2 : h2 + hueDelta(h2, hue(3), grey[2] ? HUE_SHORTER : mode);
	const withHue = (c: Vec4, h: number): Vec4 => [h, c[1], c[2], c[3]];
	return [withHue(q[0], h0), withHue(q[1], h1), withHue(q[2], h2), withHue(q[3], h3)];
}

/**
 * A segment's slope at its stop `q1`, by Steffen's method: between those of
 * its two sides, and flat at a peak, so the curve never overshoots.
 */
function steffenSlope(q0: Vec4, q1: Vec4, q2: Vec4, h0: number, h1: number): Vec4 {
	const left = h0 > 0 ? scale(sub(q1, q0), 1 / h0) : ([0, 0, 0, 0] as Vec4);
	const right = h1 > 0 ? scale(sub(q2, q1), 1 / h1) : ([0, 0, 0, 0] as Vec4);
	const span = h0 + h1;
	const middle = span > 0 ? scale(add(scale(left, h1), scale(right, h0)), 1 / span) : left;
	return each(left, (l, i) => {
		const r = right[i] ?? 0;
		const m = middle[i] ?? 0;
		return (
			(Math.sign(l) + Math.sign(r)) * Math.min(Math.abs(l), Math.abs(r), 0.5 * Math.abs(m))
		);
	});
}

/**
 * Interpolate the segment from `q1` to `q2` (at `x1` and `x2`), `q0` and `q3`
 * being their neighbours (at `x0` and `x3`): a copy of `q1` when it's the
 * first stop (`first`), of `q2` when it's the last (`last`).
 */
function interpolate(
	interpolation: number,
	x: number,
	[x0, x1, x2, x3]: readonly [number, number, number, number],
	[q0, q1, q2, q3]: readonly [Vec4, Vec4, Vec4, Vec4],
	first: boolean,
	last: boolean,
): Vec4 {
	const t = x2 > x1 ? clamp01((x - x1) / (x2 - x1)) : x >= x2 ? 1 : 0;
	switch (interpolation) {
		case RAMP_CONSTANT:
			return t >= 1 ? q2 : q1;
		case RAMP_EASE:
			return mix(q1, q2, t * t * (3 - 2 * t));
		case RAMP_CARDINAL: {
			const fc = RAMP_CARDINAL_TENSION;
			const t2 = t * t;
			const t3 = t2 * t;
			return weighted(
				[q0, q1, q2, q3],
				[
					-fc * t3 + 2 * fc * t2 - fc * t,
					(2 - fc) * t3 + (fc - 3) * t2 + 1,
					(fc - 2) * t3 + (3 - 2 * fc) * t2 + fc * t,
					fc * t3 - fc * t2,
				],
			);
		}
		case RAMP_B_SPLINE: {
			// End stops are mirrored past the ends, so the curve reaches them.
			const b0 = first ? sub(scale(q1, 2), q2) : q0;
			const b3 = last ? sub(scale(q2, 2), q1) : q3;
			const t2 = t * t;
			const t3 = t2 * t;
			return weighted(
				[b0, q1, q2, b3],
				[
					(-t3 + 3 * t2 - 3 * t + 1) / 6,
					(3 * t3 - 6 * t2 + 4) / 6,
					(-3 * t3 + 3 * t2 + 3 * t + 1) / 6,
					t3 / 6,
				],
			);
		}
		case RAMP_SMOOTH: {
			// Flat at the end stops, as the ramp is past them.
			const h = x2 - x1;
			const m1 = first ? ([0, 0, 0, 0] as Vec4) : steffenSlope(q0, q1, q2, x1 - x0, h);
			const m2 = last ? ([0, 0, 0, 0] as Vec4) : steffenSlope(q1, q2, q3, h, x3 - x2);
			const t2 = t * t;
			const t3 = t2 * t;
			return add(
				weighted([q1, q2], [2 * t3 - 3 * t2 + 1, -2 * t3 + 3 * t2]),
				weighted([m1, m2], [(t3 - 2 * t2 + t) * h, (t3 - t2) * h]),
			);
		}
		default:
			return mix(q1, q2, t);
	}
}

/** The colour (linear RGB and alpha) of a ramp at `x`. */
export function evaluateRamp(stops: readonly RampColorStop[], x: number, modes: RampModes): Vec4 {
	const count = stops.length;
	const only = stops[0];
	if (count < 2 || !only) return only?.color ?? [0, 0, 0, 1];
	let i = 0;
	for (let k = 1; k < count - 1; k++) {
		if ((stops[k]?.position ?? 0) <= x) i = k;
	}
	const at = (k: number) => stops[clamp(k, 0, count - 1)] ?? only;
	const around = [at(i - 1), at(i), at(i + 1), at(i + 2)] as const;
	const first = i === 0;
	const last = i + 2 >= count;
	const { interpolation, space, hue } = modes;
	let q = around.map((s) => rampToSpace(s.color, space)) as [Vec4, Vec4, Vec4, Vec4];
	if (space === RAMP_HSV || space === RAMP_OKLCH) q = unwrapHues(q, hue);
	if (first) q[0] = q[1];
	if (last) q[3] = q[2];
	const positions = around.map((s) => s.position) as [number, number, number, number];
	return rampFromSpace(interpolate(interpolation, x, positions, q, first, last), space);
}
