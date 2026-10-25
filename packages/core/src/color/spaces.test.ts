import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { evaluate } from "../testing/evaluate";
import { libraryEntry, managerFor, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { NodeData } from "../types";
import { linearToOklch, oklchToLinear } from "./convert";

type Vec3 = [number, number, number];

/** The only handle of a standard-library converter's group input or output. */
function handleOf(id: string, boundary: "group-input" | "group-output"): string {
	const node = libraryEntry(id).definition.nodes.find((n) => n.type === boundary);
	return node?.data.handles?.[0]?.id ?? "";
}

const instance = (id: string, nodeId: string, data: NodeData = {}): TestNode => ({
	id: nodeId,
	type: "node-group",
	data,
	group: { definitionRef: libraryEntry(id).ref, locked: true },
});

/** A chain of standard-library converters applied to `value`, on the CPU. */
function convert(ids: string[], [x, y, z]: Vec3): number[] {
	const nodes = ids.map((id, i) =>
		instance(
			id,
			`n${String(i)}`,
			i === 0 ? { values: { [handleOf(id, "group-input")]: { x, y, z } } } : {},
		),
	);
	const edges = ids
		.slice(1)
		.map((id, i): TestEdge => [
			`n${String(i)}`,
			handleOf(ids[i] ?? "", "group-output"),
			`n${String(i + 1)}`,
			handleOf(id, "group-input"),
		]);
	const last = ids.length - 1;
	return evaluate(
		managerFor(nodes, edges),
		`n${String(last)}`,
		handleOf(ids[last] ?? "", "group-output"),
	);
}

const expectClose = (actual: number[], expected: number[], digits = 4) => {
	expect(actual).toHaveLength(expected.length);
	expected.forEach((n, i) => {
		expect(actual[i]).toBeCloseTo(n, digits);
	});
};

const SAMPLES: Vec3[] = [
	[0.8, 0.2, 0.1],
	[0.05, 0.6, 0.9],
	[0.5, 0.5, 0.5],
	[0, 0, 0],
	[1, 1, 1],
];

describe("colour space groups", () => {
	it("maps white to D65 in XYZ", () => {
		expectClose(convert(["std-linear-rgb-to-xyz"], [1, 1, 1]), [0.9505, 1, 1.0891]);
	});

	it("goes to OKLch and back as the colour picker does", () => {
		for (const [r, g, b] of SAMPLES) {
			const lch = convert(
				["std-linear-rgb-to-xyz", "std-xyz-to-oklab", "std-oklab-to-oklch"],
				[r, g, b],
			);
			const expected = linearToOklch({ r, g, b });
			expectClose(lch.slice(0, 2), [expected.l, expected.c], 3);
			if (expected.c > 1e-3) expect(lch[2]).toBeCloseTo(expected.h, 1);

			const [l = 0, c = 0, h = 0] = lch;
			const back = convert(
				["std-oklch-to-oklab", "std-oklab-to-xyz", "std-xyz-to-linear-rgb"],
				[l, c, h],
			);
			// The picker uses Ottosson's matrices straight from linear sRGB,
			// slightly off going through XYZ.
			const linear = oklchToLinear({ l, c, h });
			expectClose(back, [linear.r, linear.g, linear.b], 2);
			expectClose(back, [r, g, b], 4);
		}
	});

	it("compiles each converter", () => {
		if (!nagaBin) return;
		for (const id of [
			"std-linear-rgb-to-xyz",
			"std-xyz-to-linear-rgb",
			"std-xyz-to-oklab",
			"std-oklab-to-xyz",
			"std-oklab-to-oklch",
			"std-oklch-to-oklab",
		]) {
			const entry = libraryEntry(id);
			const out =
				entry.definition.nodes.find((n) => n.type === "group-output")?.data.handles?.[0]
					?.id ?? "";
			const graph = managerFor(
				[
					{
						id: "g",
						type: "node-group",
						group: { definitionRef: entry.ref, locked: true },
					},
				],
				[["g", out, "out", "color"]],
			);
			expect(validateFragment(generateShader(graph).shader)).toBeNull();
		}
	});
});
