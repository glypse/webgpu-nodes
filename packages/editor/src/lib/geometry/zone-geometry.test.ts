import { describe, expect, it } from "vitest";

import { boundaryPoints, bubblePath, convexHull, roundedHullPath } from "./zone-geometry";

describe("zone bubble geometry", () => {
	it("keeps only the outer points of a hull", () => {
		const hull = convexHull([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 5, y: 5 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
			{ x: 5, y: 0 },
		]);
		expect(hull).toHaveLength(4);
		expect(hull).not.toContainEqual({ x: 5, y: 5 });
	});

	it("pushes every edge outward by the padding", () => {
		const path = roundedHullPath(
			convexHull([
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			]),
			2,
		);
		const coords = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
		expect(Math.min(...coords)).toBe(-2);
		expect(Math.max(...coords)).toBe(12);
		expect(path.match(/A /g)).toHaveLength(4);
		expect(path.endsWith("Z")).toBe(true);
	});

	it("encloses several node rectangles", () => {
		const path = bubblePath(
			[
				{ x: 0, y: 0, width: 100, height: 50 },
				{ x: 300, y: 100, width: 100, height: 50 },
			],
			10,
		);
		expect(path.startsWith("M ")).toBe(true);
		expect(path).toContain("A 10 10");
	});

	it("cuts through the middle of the zone's boundary nodes", () => {
		const input = { x: 0, y: 0, width: 100, height: 60 };
		const output = { x: 400, y: 0, width: 100, height: 60 };
		const path = bubblePath([], 10, boundaryPoints(input, output, 10));
		const xs = [...path.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));
		expect(Math.min(...xs)).toBe(50);
		expect(Math.max(...xs)).toBe(450);
	});

	it("keeps the padding but rounds corners by the given radius", () => {
		const path = bubblePath([{ x: 0, y: 0, width: 100, height: 50 }], 20, [], 6);
		const coords = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
		expect(Math.min(...coords)).toBe(-20);
		expect(Math.max(...coords)).toBe(120);
		expect(path).toContain("A 6 6");
		expect(path).not.toContain("A 20 20");
	});

	it("returns nothing for no rectangles", () => {
		expect(bubblePath([], 10)).toBe("");
	});
});
