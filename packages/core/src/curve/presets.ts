import type { CurvePoint, CurvePointKind, Vec2 } from "./curve";

export type CurvePreset = { id: string; label: string; points: readonly CurvePoint[] };

function point(
	x: number,
	y: number,
	kind: CurvePointKind,
	left: Vec2 = { x: 0, y: 0 },
	right: Vec2 = { x: 0, y: 0 },
): CurvePoint {
	return { x, y, kind, left, right };
}

const THIRD = 1 / 3;
/** Control point distance drawing a quarter circle with a cubic Bézier. */
const CIRCLE = 0.5523;
/** The handle reach of CSS's `ease-in` / `ease-out`. */
const EASE = 0.42;

/** The identity: aligned handles along the diagonal, so added points are smooth. */
export const LINEAR_CURVE: readonly CurvePoint[] = [
	point(0, 0, "aligned", { x: -THIRD, y: -THIRD }, { x: THIRD, y: THIRD }),
	point(1, 1, "aligned", { x: -THIRD, y: -THIRD }, { x: THIRD, y: THIRD }),
];

export const CURVE_PRESETS: readonly CurvePreset[] = [
	{ id: "linear", label: "Linear", points: LINEAR_CURVE },
	{
		id: "ease-in",
		label: "Ease in",
		points: [
			point(0, 0, "aligned", { x: -EASE, y: 0 }, { x: EASE, y: 0 }),
			point(1, 1, "aligned", { x: -THIRD, y: -THIRD }, { x: THIRD, y: THIRD }),
		],
	},
	{
		id: "ease-out",
		label: "Ease out",
		points: [
			point(0, 0, "aligned", { x: -THIRD, y: -THIRD }, { x: THIRD, y: THIRD }),
			point(1, 1, "aligned", { x: -EASE, y: 0 }, { x: EASE, y: 0 }),
		],
	},
	{
		id: "ease-in-out",
		label: "Ease in and out",
		points: [
			point(0, 0, "aligned", { x: -EASE, y: 0 }, { x: EASE, y: 0 }),
			point(1, 1, "aligned", { x: -EASE, y: 0 }, { x: EASE, y: 0 }),
		],
	},
	{
		id: "round",
		label: "Round",
		points: [
			point(0, 0, "aligned", { x: 0, y: -CIRCLE }, { x: 0, y: CIRCLE }),
			point(1, 1, "aligned", { x: -CIRCLE, y: 0 }, { x: CIRCLE, y: 0 }),
		],
	},
	{
		id: "bell",
		label: "Bell",
		points: [
			point(0, 0, "aligned", { x: -0.25, y: 0 }, { x: 0.25, y: 0 }),
			point(0.5, 1, "mirrored", { x: -0.15, y: 0 }, { x: 0.15, y: 0 }),
			point(1, 0, "aligned", { x: -0.25, y: 0 }, { x: 0.25, y: 0 }),
		],
	},
	{
		id: "invert",
		label: "Invert",
		points: [
			point(0, 1, "aligned", { x: -THIRD, y: THIRD }, { x: THIRD, y: -THIRD }),
			point(1, 0, "aligned", { x: -THIRD, y: THIRD }, { x: THIRD, y: -THIRD }),
		],
	},
];
