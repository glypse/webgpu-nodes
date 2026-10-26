import { describe, expect, it } from "vitest";

import {
	NUMERIC_TYPES,
	convertVar,
	fitType,
	highestType,
	isConnectionCompatible,
	joinTypes,
	makeType,
	wgslTypeName,
} from ".";

describe("type lattice", () => {
	it("builds and names types", () => {
		expect(makeType("i32", 3)).toBe("vec3i");
		expect(makeType("bool", 1)).toBe("bool");
		expect(wgslTypeName("vec2b")).toBe("vec2<bool>");
		expect(wgslTypeName("vec4u")).toBe("vec4u");
	});

	it("joins to the widest kind and most components", () => {
		expect(joinTypes("i32", "vec2f")).toBe("vec2f");
		expect(joinTypes("vec3i", "u32")).toBe("vec3i");
		expect(joinTypes("bool", "vec2b")).toBe("vec2b");
	});

	it("fits wanted types into families", () => {
		expect(fitType("i32", NUMERIC_TYPES)).toBe("i32");
		expect(fitType("bool", NUMERIC_TYPES)).toBe("f32");
		expect(fitType("vec2i", ["f32", "vec2f", "vec3f", "vec4f"])).toBe("vec2f");
		expect(fitType("vec2f", ["vec3f"])).toBe("vec3f");
		expect(highestType([], ["i32", "vec2i"])).toBe("i32");
		expect(highestType(["i32", "f32"], NUMERIC_TYPES)).toBe("f32");
	});

	it("only allows connections that don't drop components", () => {
		expect(isConnectionCompatible("vec2i", "vec4f")).toBe(true);
		expect(isConnectionCompatible("bool", "f32")).toBe(true);
		expect(isConnectionCompatible("vec3f", "vec2f")).toBe(false);
	});
});

describe("convertVar", () => {
	it("converts kinds with WGSL constructors", () => {
		expect(convertVar("x", "f32", "i32")).toBe("i32(x)");
		expect(convertVar("v", "vec3i", "vec3f")).toBe("vec3f(v)");
		expect(convertVar("b", "vec2b", "vec2u")).toBe("vec2u(b)");
		expect(convertVar("v", "vec2f", "vec2b")).toBe("vec2<bool>(v)");
	});

	it("splats scalars and pads vectors", () => {
		expect(convertVar("x", "i32", "vec3f")).toBe("vec3f(f32(x))");
		expect(convertVar("v", "vec2f", "vec4f")).toBe("vec4f(v, 0.0, 0.0)");
		expect(convertVar("v", "vec2i", "vec3f")).toBe("vec3f(vec2f(v), 0.0)");
		expect(convertVar("v", "vec2b", "vec3b")).toBe("vec3<bool>(v, false)");
	});

	it("narrows with a swizzle", () => {
		expect(convertVar("v", "vec4f", "vec2i")).toBe("vec2i(v.xy)");
	});
});
