import { describe, expect, it } from "vitest";

import { bezierMidpointAngle } from "./edge-geometry";

describe("bezierMidpointAngle", () => {
	it("points along straight edges", () => {
		expect(bezierMidpointAngle(0, 0, 100, 0)).toBe(0);
	});

	it("follows the S-curve's steeper middle", () => {
		// Tangent (0.5 * dx, dy) for forward edges: steeper than the chord.
		expect(bezierMidpointAngle(0, 0, 100, 100)).toBeCloseTo(63.43, 1);
	});

	it("handles backward edges", () => {
		expect(Math.abs(bezierMidpointAngle(100, 0, 0, 0))).toBe(180);
	});
});
