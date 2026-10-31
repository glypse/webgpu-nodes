import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import type { ColorSpace } from "../graph/settings";
import {
	type V,
	cssGamutMap,
	deltaEOK,
	lin,
	linearToOklab,
	linearToP3,
	oklabToLinear,
	oklchToOklab,
	p3ToLinear,
} from "../testing/css-color";
import { evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, managerFor } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import { oklchToLinear } from "./convert";

const MAP = libraryEntry("std-oklch-gamut-map");
const MAP_IN = libraryHandle(MAP, "group-input", "OKLch");
const MAP_OUT = libraryHandle(MAP, "group-output", "Linear RGB");
const COLOR = libraryEntry("std-color");
const MODE = libraryHandle(COLOR, "group-input", "Mode");
const COLOR_OUT = libraryHandle(COLOR, "group-output", "Color");
const OKLCH = 2;

/** Colours across lightness, chroma and hue, two thirds out of the sRGB gamut. */
const SAMPLES: V[] = [0.15, 0.35, 0.55, 0.75, 0.92].flatMap((l) =>
	[0.05, 0.12, 0.22, 0.32].flatMap((c) => [0, 72, 144, 216, 288].map((h): V => [l, c, h])),
);

const inGamut = (lch: V) => oklabToLinear(oklchToOklab(lch)).every((n) => n >= 0 && n <= 1);
/** The CSS reference, in linear sRGB. */
function reference(lch: V, gamut: ColorSpace = "srgb"): V {
	const mapped = cssGamutMap(lch, gamut).map(lin) as V;
	return gamut === "srgb" ? mapped : p3ToLinear(mapped);
}
const distance = (a: V, b: V) => deltaEOK(linearToOklab(a), linearToOklab(b));

function gamutMap([x, y, z]: V, gamut: ColorSpace = "srgb"): V {
	const graph = managerFor(
		[
			{
				id: "g",
				type: "node-group",
				data: { values: { [MAP_IN]: { x, y, z } } },
				group: { definitionRef: MAP.ref, locked: true },
			},
		],
		[],
	);
	return evaluate(graph, "g", MAP_OUT, gamut) as V;
}

describe("OKLch gamut mapping", () => {
	it("tests both sides of the gamut", () => {
		expect(SAMPLES.filter(inGamut).length).toBeGreaterThan(20);
		expect(SAMPLES.filter((s) => !inGamut(s)).length).toBeGreaterThan(50);
	});

	it("maps colours into sRGB as CSS Color 4 does", () => {
		for (const lch of SAMPLES) {
			const ours = gamutMap(lch);
			for (const n of ours) {
				expect(n).toBeGreaterThanOrEqual(0);
				expect(n).toBeLessThanOrEqual(1);
			}
			// CSS stops its search 1e-4 of chroma short; a JND is 0.02.
			expect(distance(ours, reference(lch))).toBeLessThan(2e-4);
		}
	});

	it("leaves colours in gamut as they are", () => {
		for (const lch of SAMPLES.filter(inGamut)) {
			const exact = oklabToLinear(oklchToOklab(lch));
			gamutMap(lch).forEach((n, i) => {
				expect(n).toBeCloseTo(exact[i] ?? 0, 6);
			});
		}
	});

	it("maps colours into Display P3 as CSS Color 4 does when drawn to it", () => {
		const inP3 = (lch: V) => linearToP3(oklabToLinear(oklchToOklab(lch)));
		expect(
			SAMPLES.filter((s) => !inGamut(s) && inP3(s).every((n) => n >= 0 && n <= 1)),
		).not.toHaveLength(0);
		for (const lch of SAMPLES) {
			const ours = gamutMap(lch, "display-p3");
			for (const n of linearToP3(ours)) {
				expect(n).toBeGreaterThanOrEqual(-1e-6);
				expect(n).toBeLessThanOrEqual(1 + 1e-6);
			}
			expect(distance(ours, reference(lch, "display-p3"))).toBeLessThan(2e-4);
		}
	});

	it("keeps colours past sRGB but within Display P3 as they are", () => {
		const lch: V = [0.7015, 0.1559, 203.59];
		const exact = oklabToLinear(oklchToOklab(lch));
		expect(exact[0]).toBeLessThan(0);
		gamutMap(lch, "display-p3").forEach((n, i) => {
			expect(n).toBeCloseTo(exact[i] ?? 0, 6);
		});
	});

	it("maps the extremes of lightness to white and black", () => {
		expect(gamutMap([1.2, 0.3, 40])).toEqual([1, 1, 1]);
		expect(gamutMap([-0.1, 0.3, 40])).toEqual([0, 0, 0]);
	});

	it("is what the colour picker shows", () => {
		for (const lch of SAMPLES) {
			const [l, c, h] = lch;
			const { r, g, b } = oklchToLinear({ l, c, h });
			expect(distance([r, g, b], reference(lch))).toBeLessThan(2e-4);
		}
	});

	it("is what the Color node gives in OKLch", () => {
		const inputs =
			(COLOR.widget?.kind === "color"
				? COLOR.widget.modes[String(OKLCH)]?.components
				: undefined) ?? [];
		for (const lch of SAMPLES.filter((_, i) => i % 7 === 0)) {
			const values = Object.fromEntries(inputs.map((id, i) => [id, lch[i] ?? 0]));
			const graph = managerFor(
				[
					{
						id: "c",
						type: "node-group",
						data: { values: { [MODE]: OKLCH, ...values } },
						group: { definitionRef: COLOR.ref, locked: true },
					},
				],
				[],
			);
			for (const gamut of ["srgb", "display-p3"] as const) {
				const ours = evaluate(graph, "c", COLOR_OUT, gamut) as V;
				expect(distance(ours, reference(lch, gamut))).toBeLessThan(2e-4);
			}
		}
	});

	it("compiles", () => {
		if (!nagaBin) return;
		const graph = managerFor(
			[
				{
					id: "g",
					type: "node-group",
					data: { values: { [MAP_IN]: { x: 0.7, y: 0.3, z: 200 } } },
					group: { definitionRef: MAP.ref, locked: true },
				},
			],
			[["g", MAP_OUT, "out", "color"]],
		);
		const { shader } = generateShader(graph);
		expect(shader).toContain("for (var");
		expect(validateFragment(shader)).toBeNull();
	});
});
