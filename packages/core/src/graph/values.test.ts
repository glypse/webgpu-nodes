import { describe, expect, it } from "vitest";

import { readComponent, withComponent } from "./values";

describe("stored input values", () => {
	it("reads scalars as filling every component", () => {
		expect(readComponent(2, "y")).toBe(2);
		expect(readComponent(true, "_")).toBe(1);
		expect(readComponent({ x: 1, y: false }, "y")).toBe(0);
	});

	it("writes one component, spreading a scalar first", () => {
		expect(withComponent(3, "f32", "_", 4)).toBe(4);
		expect(withComponent(3, "vec3f", "y", 1)).toEqual({ x: 3, y: 1, z: 3 });
		expect(withComponent({ x: 1, y: 2 }, "vec2f", "x", 5)).toEqual({ x: 5, y: 2 });
	});
});
