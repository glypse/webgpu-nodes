import { describe, expect, it } from "vitest";

import { firstCrossing, segmentCrossing } from "./stroke";

describe("segmentCrossing", () => {
	it("finds where two segments cross", () => {
		expect(
			segmentCrossing({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
		).toEqual({ x: 5, y: 5 });
	});

	it("ignores segments that would only cross further along", () => {
		expect(
			segmentCrossing({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
		).toBeUndefined();
	});

	it("ignores parallel segments", () => {
		expect(
			segmentCrossing({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }),
		).toBeUndefined();
	});
});

describe("firstCrossing", () => {
	const line = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
	];

	it("finds the first crossing along the stroke", () => {
		const stroke = [
			{ x: 20, y: -10 },
			{ x: 20, y: 10 },
			{ x: 60, y: 10 },
			{ x: 60, y: -10 },
		];
		expect(firstCrossing(stroke, line)).toEqual({ x: 20, y: 0 });
	});

	it("misses lines the stroke doesn't reach", () => {
		const stroke = [
			{ x: 20, y: 5 },
			{ x: 80, y: 10 },
		];
		expect(firstCrossing(stroke, line)).toBeUndefined();
	});
});
