import { describe, expect, it } from "bun:test";

import { generateShader } from "../codegen";
import { colorToLinear } from "../color/modes";
import { ROOT_ID } from "../graph/document";
import {
	evaluateRamp,
	HUE_INCREASING,
	HUE_LONGER,
	HUE_SHORTER,
	RAMP_B_SPLINE,
	RAMP_CARDINAL,
	RAMP_CONSTANT,
	RAMP_EASE,
	RAMP_HSV,
	RAMP_HUES,
	RAMP_INTERPOLATIONS,
	RAMP_LINEAR,
	RAMP_OKLCH,
	RAMP_RGB,
	RAMP_SMOOTH,
	RAMP_SPACES,
	type RampColorStop,
	type RampModes,
	rampToSpace,
	type Vec4,
} from "../ramp";
import { evaluate } from "../testing/evaluate";
import { managerFor, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { NodeData, VectorValue } from "../types";
import { COLOR_RAMP, RAMP_FACTOR, RAMP_HUE, RAMP_INTERPOLATION, RAMP_SPACE } from "./color-ramp";

const RED: Vec4 = [1, 0, 0, 1];
const GREEN: Vec4 = [0, 1, 0, 1];
const BLUE: Vec4 = [0, 0, 1, 1];
const WHITE: Vec4 = [1, 1, 1, 1];

const modes = (m: Partial<RampModes> = {}): RampModes => ({
	interpolation: RAMP_LINEAR,
	space: RAMP_RGB,
	hue: HUE_SHORTER,
	...m,
});

const stops = (...colors: [number, Vec4][]): RampColorStop[] =>
	colors.map(([position, color]) => ({ position, color }));

const close = (actual: Vec4, expected: Vec4, digits = 5) => {
	expected.forEach((n, i) => {
		expect(actual[i]).toBeCloseTo(n, digits);
	});
};

const vector = ([x, y, z, w]: Vec4): VectorValue => ({ x, y, z, w });

/** A Color Ramp `r` of `colors` (by stop id) at `factor`, linked to the output. */
function rampGraph(data: NodeData, nodes: TestNode[] = [], edges: TestEdge[] = []) {
	return managerFor(
		[{ id: "r", type: COLOR_RAMP, data }, ...nodes],
		[["r", "color", "out", "color"], ...edges],
	);
}

const threeStops = (values: Record<string, number | VectorValue> = {}): NodeData => ({
	ramp: [
		{ id: "stop-0", position: 0 },
		{ id: "stop-1", position: 0.3 },
		{ id: "stop-2", position: 1 },
	],
	values: {
		"stop-0": vector(RED),
		"stop-1": vector(GREEN),
		"stop-2": vector(BLUE),
		...values,
	},
});

describe("Color Ramp evaluation", () => {
	const ramp = stops([0.2, RED], [0.6, BLUE]);

	it("keeps the end colours past the end stops", () => {
		for (const { value } of RAMP_INTERPOLATIONS) {
			for (const space of RAMP_SPACES) {
				const m = modes({ interpolation: value, space: space.value });
				close(evaluateRamp(ramp, 0, m), RED, 4);
				close(evaluateRamp(ramp, 0.2, m), RED, 4);
				close(evaluateRamp(ramp, 0.6, m), BLUE, 4);
				close(evaluateRamp(ramp, 1.5, m), BLUE, 4);
			}
		}
	});

	it("passes through every stop", () => {
		const many = stops([0, RED], [0.25, GREEN], [0.5, WHITE], [0.9, BLUE]);
		for (const { value } of RAMP_INTERPOLATIONS) {
			if (value === RAMP_B_SPLINE) continue;
			for (const stop of many) close(evaluateRamp(many, stop.position, modes()), stop.color);
		}
	});

	it("interpolates as Blender does", () => {
		const at = (interpolation: number, x: number) =>
			evaluateRamp(ramp, x, modes({ interpolation }))[0];
		expect(at(RAMP_LINEAR, 0.3)).toBeCloseTo(0.75);
		expect(at(RAMP_EASE, 0.3)).toBeCloseTo(1 - (0.0625 * 3 - 2 * 0.015625));
		expect(at(RAMP_CONSTANT, 0.59)).toBe(1);
		expect(at(RAMP_CONSTANT, 0.6)).toBe(0);
	});

	it("doesn't overshoot when smooth", () => {
		const bumpy = stops(
			[0, [0, 0, 0, 1]],
			[0.1, [1, 1, 1, 1]],
			[0.9, [1, 1, 1, 1]],
			[1, [0, 0, 0, 1]],
		);
		const smooth = modes({ interpolation: RAMP_SMOOTH });
		const cardinal = modes({ interpolation: RAMP_CARDINAL });
		const peak = (m: RampModes) =>
			Math.max(...Array.from({ length: 101 }, (_, i) => evaluateRamp(bumpy, i / 100, m)[0]));
		expect(peak(smooth)).toBeCloseTo(1, 6);
		expect(peak(cardinal)).toBeGreaterThan(1);
		// Smooth where the linear ramp has a corner.
		const corner = stops([0, [0, 0, 0, 1]], [0.5, [1, 0, 0, 1]], [1, [1.5, 0, 0, 1]]);
		const slope = (x: number) =>
			(evaluateRamp(corner, x + 1e-4, smooth)[0] -
				evaluateRamp(corner, x - 1e-4, smooth)[0]) /
			2e-4;
		expect(slope(0.5 - 1e-3)).toBeCloseTo(slope(0.5 + 1e-3), 1);
	});

	it("goes the way around the hue circle its hue interpolation picks", () => {
		// Hues 0.9 and 0.1 (in turns).
		const [a, b] = [colorToLinear("hsv", [0.9, 1, 1]), colorToLinear("hsv", [0.1, 1, 1])];
		const hues = stops([0, [a.r, a.g, a.b, 1]], [1, [b.r, b.g, b.b, 1]]);
		const hueAt = (hue: number) =>
			rampToSpace(evaluateRamp(hues, 0.5, modes({ space: RAMP_HSV, hue })), RAMP_HSV)[0];
		expect(hueAt(HUE_SHORTER)).toBeCloseTo(0, 4);
		expect(hueAt(HUE_LONGER)).toBeCloseTo(0.5, 4);
		expect(hueAt(HUE_INCREASING)).toBeCloseTo(0, 4);
	});

	it("gives a grey stop its neighbour's hue", () => {
		const grey = stops([0, WHITE], [1, BLUE]);
		const hue = rampToSpace(BLUE, RAMP_OKLCH)[0];
		for (const mode of RAMP_HUES) {
			const half = evaluateRamp(grey, 0.5, modes({ space: RAMP_OKLCH, hue: mode.value }));
			expect(rampToSpace(half, RAMP_OKLCH)[0]).toBeCloseTo(hue, 4);
		}
	});

	it("takes a grey's hue from its nearest colourful stop, not from noise", () => {
		const around = (grey: Vec4) => stops([0, RED], [0.3, [0, 0, 0, 1]], [0.6, grey], [1, BLUE]);
		const m = modes({ interpolation: RAMP_B_SPLINE, space: RAMP_OKLCH });
		const a = evaluateRamp(around([0.5, 0.5, 0.5, 1]), 0.55, m);
		const b = evaluateRamp(around([0.5, 0.5, 0.5 + 1e-6, 1]), 0.55, m);
		close(a, b, 4);
	});

	it("interpolates alpha", () => {
		const fade = stops([0, [1, 0, 0, 0]], [1, RED]);
		expect(evaluateRamp(fade, 0.25, modes({ space: RAMP_OKLCH }))[3]).toBeCloseTo(0.25);
	});
});

describe("Color Ramp node", () => {
	it("computes its colour from its stops' inputs", () => {
		const graph = rampGraph(threeStops({ [RAMP_FACTOR]: 0.15 }));
		const [r = 0, g = 0, b = 0] = evaluate(graph, "r", "color");
		expect([r, g, b].map((n) => Number(n.toFixed(5)))).toEqual([0.5, 0.5, 0]);
	});

	it("takes a linked stop's colour, and gives RGBA once one is", () => {
		const graph = rampGraph(
			threeStops({ [RAMP_FACTOR]: 1 }),
			[
				{
					id: "c",
					type: "declare",
					data: {
						types: { declare: "vec4f" },
						values: { x: 0.1, y: 0.2, z: 0.3, w: 0.4 },
					},
				},
			],
			[["c", "value", "r", "stop-2"]],
		);
		const color = evaluate(graph, "r", "color");
		expect(color.map((n) => Number(n.toFixed(5)))).toEqual([0.1, 0.2, 0.3, 0.4]);
	});

	it("compiles every interpolation in every space", () => {
		if (!nagaBin) return;
		for (const interpolation of RAMP_INTERPOLATIONS) {
			for (const space of RAMP_SPACES) {
				for (const hue of RAMP_HUES) {
					const { shader } = generateShader(
						rampGraph(
							threeStops({
								[RAMP_INTERPOLATION]: interpolation.value,
								[RAMP_SPACE]: space.value,
								[RAMP_HUE]: hue.value,
							}),
						),
					);
					expect(validateFragment(shader)).toBeNull();
				}
			}
		}
	});

	it("switches per pixel on enums only known there", () => {
		const graph = rampGraph(
			threeStops(),
			[{ id: "m", type: "declare", data: { types: { declare: "u32" }, values: { x: 1 } } }],
			[
				["m", "value", "r", RAMP_INTERPOLATION],
				["m", "value", "r", RAMP_SPACE],
				["m", "value", "r", RAMP_HUE],
			],
		);
		const { shader } = generateShader(graph);
		expect(shader).toContain("color_ramp_any_any_any");
		expect(shader).toContain("switch (interpolation)");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("only compiles what its enums pick", () => {
		const shader = generateShader(rampGraph(threeStops())).shader;
		expect(shader).not.toContain("color_ramp_to_oklch");
		expect(shader).not.toContain("switch");
		const oklch = generateShader(rampGraph(threeStops({ [RAMP_SPACE]: RAMP_OKLCH }))).shader;
		expect(oklch).toContain("color_ramp_to_oklch");
		expect(oklch).not.toContain("color_ramp_to_hsv");
	});

	it("passes positions as uniforms, so moving a stop doesn't recompile", () => {
		const graph = rampGraph(threeStops());
		const before = generateShader(graph, { uniformScopes: [ROOT_ID] });
		graph.setColorRamp("r", [
			{ id: "stop-0", position: 0 },
			{ id: "stop-1", position: 0.6 },
			{ id: "stop-2", position: 1 },
		]);
		const after = generateShader(graph, { uniformScopes: [ROOT_ID] });
		expect(after.shader).toBe(before.shader);
	});

	it("drops the links and colours of the stops it loses, keeping the others'", () => {
		const graph = rampGraph(
			threeStops(),
			[{ id: "t", type: "time" }],
			[
				["t", "seconds", "r", "stop-1"],
				["t", "seconds", "r", "stop-2"],
			],
		);
		graph.setColorRamp("r", [
			{ id: "stop-2", position: 0.1 },
			{ id: "stop-0", position: 0.5 },
		]);
		const node = graph.root.nodesById.get("r");
		expect(node?.data.values?.["stop-1"]).toBeUndefined();
		expect(graph.root.edges.filter((e) => e.target === "r").map((e) => e.targetHandle)).toEqual(
			["stop-2"],
		);
		expect(
			graph
				.resolveNodeInputs("r")
				.map((i) => i.id)
				.slice(-2),
		).toEqual(["stop-2", "stop-0"]);
	});

	it("hides its hue interpolation while in RGB", () => {
		const graph = rampGraph(threeStops());
		expect(graph.hiddenInputs("r").has(RAMP_HUE)).toBe(true);
		graph.setInputValue("r", RAMP_SPACE, RAMP_HSV);
		expect(graph.hiddenInputs("r").has(RAMP_HUE)).toBe(false);
	});

	it("saves and loads its stops", async () => {
		const graph = rampGraph(threeStops());
		const copy = managerFor([], []);
		expect((await copy.loadFromString(graph.getProjectJson())).ok).toBe(true);
		expect(copy.root.nodesById.get("r")?.data.ramp).toHaveLength(3);
	});
});
