import { describe, expect, it } from "vitest";

import {
	type CurvePoint,
	CURVE_PRESETS,
	LINEAR_CURVE,
	addCurvePoint,
	curveSegments,
	evaluateCurve,
	flipCurveX,
	flipCurveY,
	insertCurvePoint,
	moveCurveHandle,
	moveCurvePoint,
	removeCurvePoint,
	setCurvePointKind,
} from ".";
import { generateShader } from "../codegen";
import { ROOT_ID } from "../graph/document";
import { evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, managerFor, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";

const preset = (id: string): readonly CurvePoint[] => {
	const found = CURVE_PRESETS.find((p) => p.id === id);
	if (!found) throw new Error(`no preset "${id}"`);
	return found.points;
};

const corner = (x: number, y: number): CurvePoint => ({
	x,
	y,
	kind: "vector",
	left: { x: -0.2, y: 0.3 },
	right: { x: 0.2, y: 0.3 },
});

const samples = Array.from({ length: 21 }, (_, i) => i / 20);

describe("curve evaluation", () => {
	it("maps the linear curve to the identity", () => {
		for (const x of samples) expect(evaluateCurve(LINEAR_CURVE, x)).toBeCloseTo(x, 5);
	});

	it("stays flat past its ends", () => {
		const points = [corner(0.25, 0.1), corner(0.75, 0.9)];
		expect(evaluateCurve(points, -3)).toBe(0.1);
		expect(evaluateCurve(points, 0)).toBe(0.1);
		expect(evaluateCurve(points, 1)).toBe(0.9);
		expect(evaluateCurve(points, 4)).toBe(0.9);
	});

	it("joins vector points with straight lines, whatever handles they keep", () => {
		const points = [corner(0, 0), corner(0.5, 1), corner(1, 0)];
		expect(evaluateCurve(points, 0.25)).toBeCloseTo(0.5, 5);
		expect(evaluateCurve(points, 0.75)).toBeCloseTo(0.5, 5);
	});

	it("eases in and out symmetrically", () => {
		const points = preset("ease-in-out");
		expect(evaluateCurve(points, 0.5)).toBeCloseTo(0.5, 5);
		expect(evaluateCurve(points, 0.25)).toBeLessThan(0.25);
		expect(evaluateCurve(points, 0.75)).toBeCloseTo(1 - evaluateCurve(points, 0.25), 5);
	});

	it("shortens handles reaching past each other so x keeps growing", () => {
		const points: CurvePoint[] = [
			{ x: 0, y: 0, kind: "free", left: { x: 0, y: 0 }, right: { x: 2, y: 0 } },
			{ x: 1, y: 1, kind: "free", left: { x: -2, y: 0 }, right: { x: 0, y: 0 } },
		];
		const [segment] = curveSegments(points);
		expect(segment?.[1]).toEqual({ x: 0.5, y: 0 });
		expect(segment?.[2]).toEqual({ x: 0.5, y: 1 });
		let previous = -Infinity;
		for (const x of samples) {
			const y = evaluateCurve(points, x);
			expect(y).toBeGreaterThanOrEqual(previous - 1e-6);
			previous = y;
		}
	});
});

describe("curve editing", () => {
	it("adds a point on the curve without changing its shape", () => {
		const points = preset("ease-in-out");
		const { points: split, index } = insertCurvePoint(points, 0.3);
		expect(index).toBe(1);
		expect(split).toHaveLength(3);
		expect(split[1]?.x).toBeCloseTo(0.3, 5);
		expect(split[1]?.kind).toBe("aligned");
		for (const x of samples) {
			expect(evaluateCurve(split, x)).toBeCloseTo(evaluateCurve(points, x), 4);
		}
	});

	it("adds a vector point on a straight segment", () => {
		const { points } = insertCurvePoint([corner(0, 0), corner(1, 1)], 0.5);
		expect(points[1]).toMatchObject({ kind: "vector", x: 0.5, y: 0.5 });
	});

	it("adds a smooth point anywhere, kept in order", () => {
		const { points, index } = addCurvePoint(LINEAR_CURVE, 0.5, 0.9);
		expect(index).toBe(1);
		expect(points.map((p) => p.x)).toEqual([0, 0.5, 1]);
		const added = points[1];
		expect(added?.kind).toBe("aligned");
		// Parallel to the line between its neighbours.
		expect(added?.right.y).toBeCloseTo(added?.right.x ?? NaN, 5);
	});

	it("keeps a moved point between its neighbours and in the square", () => {
		const points = [corner(0, 0), corner(0.5, 0.5), corner(1, 1)];
		expect(moveCurvePoint(points, 1, 1.2, -1)[1]).toMatchObject({ x: 1, y: 0 });
		expect(moveCurvePoint(points, 0, 0.8, 0.5)[0]?.x).toBe(0.5);
	});

	it("flips left to right", () => {
		const points = insertCurvePoint(preset("ease-in"), 0.3).points;
		const flipped = flipCurveX(points);
		expect(flipped.map((p) => p.x)).toEqual(points.map((p) => 1 - p.x).toReversed());
		for (const x of samples) {
			expect(evaluateCurve(flipped, x)).toBeCloseTo(evaluateCurve(points, 1 - x), 5);
		}
		expect(flipCurveX(flipped)).toEqual(points);
	});

	it("flips top to bottom", () => {
		const points = insertCurvePoint(preset("ease-in"), 0.3).points;
		const flipped = flipCurveY(points);
		for (const x of samples) {
			expect(evaluateCurve(flipped, x)).toBeCloseTo(1 - evaluateCurve(points, x), 5);
		}
	});

	it("keeps at least two points", () => {
		const points = [corner(0, 0), corner(0.5, 0.5), corner(1, 1)];
		const fewer = removeCurvePoint(points, 1);
		expect(fewer).toHaveLength(2);
		expect(removeCurvePoint(fewer, 0)).toHaveLength(2);
	});

	describe("handles follow the point's kind", () => {
		const point = (kind: CurvePoint["kind"]): CurvePoint[] => [
			{ x: 0.5, y: 0.5, kind, left: { x: -0.1, y: 0 }, right: { x: 0.3, y: 0 } },
		];

		it("free: the other handle stays", () => {
			const [moved] = moveCurveHandle(point("free"), 0, "right", { x: 0.2, y: 0.2 });
			expect(moved?.left).toEqual({ x: -0.1, y: 0 });
		});

		it("aligned: the other handle turns, keeping its length", () => {
			const [moved] = moveCurveHandle(point("aligned"), 0, "right", { x: 0, y: 0.4 });
			expect(moved?.left.x).toBeCloseTo(0, 6);
			expect(moved?.left.y).toBeCloseTo(-0.1, 6);
		});

		it("mirrored: the other handle mirrors it", () => {
			const [moved] = moveCurveHandle(point("mirrored"), 0, "right", { x: 0.2, y: 0.1 });
			expect(moved?.left).toEqual({ x: -0.2, y: -0.1 });
		});

		it("never points a handle the wrong way in x", () => {
			const [moved] = moveCurveHandle(point("free"), 0, "left", { x: 0.2, y: 0.1 });
			expect(moved?.left).toEqual({ x: 0, y: 0.1 });
		});

		it("vector: there is no handle to move", () => {
			const points = point("vector");
			expect(moveCurveHandle(points, 0, "right", { x: 0.2, y: 0.1 })).toEqual(points);
		});
	});

	it("gives smooth handles to a point turned from vector without any", () => {
		const points: CurvePoint[] = [
			{ ...corner(0, 0), left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
			{ ...corner(0.5, 0.25), left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
			{ ...corner(1, 1), left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
		];
		const [, smooth] = setCurvePointKind(points, 1, "mirrored");
		expect(smooth?.kind).toBe("mirrored");
		expect(smooth?.right).toEqual({ x: 0.5 / 3, y: 0.5 / 3 });
		expect(smooth?.left).toEqual({ x: -0.5 / 3, y: -0.5 / 3 });
	});

	it("aligns the handles of a point made aligned", () => {
		const points: CurvePoint[] = [
			corner(0, 0),
			{ x: 0.5, y: 0.5, kind: "free", left: { x: -0.1, y: 0.1 }, right: { x: 0.2, y: 0 } },
			corner(1, 1),
		];
		const [, aligned] = setCurvePointKind(points, 1, "aligned");
		expect(aligned?.right).toEqual({ x: 0.2, y: 0 });
		expect(aligned?.left.x).toBeCloseTo(-Math.SQRT2 * 0.1, 6);
		expect(aligned?.left.y).toBeCloseTo(0, 6);
	});
});

describe("curve node", () => {
	const curveNode = (data: TestNode["data"] = {}): TestNode => ({ id: "c", type: "curve", data });
	const declare: TestNode = {
		id: "d",
		type: "declare",
		data: { types: { declare: "vec3f" }, values: { x: 0.25, y: 0.5, z: 0.75 } },
	};

	it("maps each component, mixed by its factor", () => {
		const graph = managerFor(
			[declare, curveNode({ values: { factor: 2 }, curve: [...preset("ease-in-out")] })],
			[
				["d", "value", "c", "value"],
				["c", "result", "out", "color"],
			],
		);
		expect(graph.resolveOutputHandleType("c", "result")).toBe("vec3f");
		const result = evaluate(graph, "c", "result");
		[0.25, 0.5, 0.75].forEach((x, i) => {
			const y = evaluateCurve(preset("ease-in-out"), x);
			expect(result[i]).toBeCloseTo(x + 2 * (y - x), 6);
		});
		const { shader } = generateShader(graph);
		expect(shader).toContain("fn curve1(x: f32, segments: array<vec4f, 2>) -> f32");
		expect(shader).toContain("vec3f(curve1(v_c_value.x, v_c_segments)");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("keeps the shader while points move, reading them from uniforms", () => {
		const graph = managerFor([curveNode()], [["c", "result", "out", "color"]]);
		const before = generateShader(graph, { uniformScope: ROOT_ID });
		graph.setCurve("c", moveCurvePoint(LINEAR_CURVE, 1, 1, 0.5));
		const after = generateShader(graph, { uniformScope: ROOT_ID });
		expect(after.shader).toBe(before.shader);
		const end = after.uniforms.u_c_segment0b;
		expect(Array.isArray(end) ? end.map((n) => n.toFixed(4)) : end).toEqual([
			"0.6667",
			"0.1667",
			"1.0000",
			"0.5000",
		]);
		if (nagaBin) expect(validateFragment(after.shader, after.uniforms)).toBeNull();
	});

	it("declares one function per segment count", () => {
		const three = insertCurvePoint(insertCurvePoint(LINEAR_CURVE, 0.3).points, 0.6).points;
		const shader = generateShader(
			managerFor(
				[
					curveNode(),
					{ ...curveNode({ curve: three }), id: "e" },
					{ id: "sum", type: "add" },
				],
				[
					["c", "result", "sum", "operands"],
					["e", "result", "sum", "operands"],
					["sum", "result", "out", "color"],
				],
			),
		).shader;
		expect(shader.match(/fn curveSegment\(/g)).toHaveLength(1);
		expect(shader).toContain("fn curve1(");
		expect(shader).toContain("fn curve3(");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});
});

describe("remap group", () => {
	const REMAP = libraryEntry("std-remap");
	const handle = (label: string) => libraryHandle(REMAP, "group-input", label);

	it("maps a value from one range to another", () => {
		const graph = managerFor(
			[
				{
					id: "r",
					type: "node-group",
					data: {
						values: {
							[handle("Value")]: 0.25,
							[handle("From Min")]: -1,
							[handle("From Max")]: 1,
							[handle("To Min")]: 10,
							[handle("To Max")]: 20,
						},
					},
					group: { definitionRef: REMAP.ref, locked: true },
				},
			],
			[],
		);
		const result = libraryHandle(REMAP, "group-output", "Result");
		expect(evaluate(graph, "r", result)[0]).toBeCloseTo(16.25, 6);
	});
});
