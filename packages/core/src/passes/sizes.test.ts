import { describe, expect, it } from "bun:test";

import {
	canMip,
	CANVAS_SIZE,
	isFilterable,
	isRenderable,
	isStorage,
	resolveSize,
	sameSize,
	sampleTypeOf,
	scalarOf,
	texelBytes,
	TEXTURE_FORMATS,
	type TextureSize,
} from "./textures";

const env = {
	canvas: { width: 1001, height: 500 },
	resource: (id: string) => (id === "half" ? { width: 40, height: 10 } : undefined),
	maxDimension: 2048,
};

describe("resolveSize", () => {
	it("rounds up, so every texel is covered", () => {
		const size: TextureSize = { kind: "scale", scale: 1 / 8, of: "canvas" };
		expect(resolveSize(size, env)).toEqual({ width: 126, height: 63 });
	});

	it("ignores the error of inexact products", () => {
		const size: TextureSize = { kind: "scale", scale: 0.1, of: "canvas" };
		expect(resolveSize(size, { ...env, canvas: { width: 1000, height: 30 } })).toEqual({
			width: 100,
			height: 3,
		});
	});

	it("is never empty, nor past the device's limit", () => {
		expect(resolveSize({ kind: "scale", scale: 0, of: "canvas" }, env)).toEqual({
			width: 1,
			height: 1,
		});
		expect(resolveSize({ kind: "pixels", width: 100000, height: -3 }, env)).toEqual({
			width: 2048,
			height: 1,
		});
	});

	it("scales another resource's current size", () => {
		const size: TextureSize = { kind: "scale", scale: 0.5, of: { resource: "half" } };
		expect(resolveSize(size, env)).toEqual({ width: 20, height: 5 });
		expect(() => resolveSize({ ...size, of: { resource: "gone" } }, env)).toThrow();
	});
});

describe("sameSize", () => {
	const half: TextureSize = { kind: "scale", scale: 0.5, of: "canvas" };

	it("proves only the equality it can see", () => {
		expect(sameSize(CANVAS_SIZE, { kind: "scale", scale: 1, of: "canvas" })).toBe(true);
		expect(sameSize(CANVAS_SIZE, half)).toBe(false);
		expect(sameSize(half, { ...half })).toBe(true);
		const of = (resource: string): TextureSize => ({
			kind: "scale",
			scale: 1,
			of: { resource },
		});
		expect(sameSize(of("a"), of("a"))).toBe(true);
		expect(sameSize(of("a"), of("b"))).toBe(false);
		expect(sameSize(of("a"), CANVAS_SIZE)).toBe(false);
		const pixels: TextureSize = { kind: "pixels", width: 4, height: 2 };
		expect(sameSize(pixels, { ...pixels })).toBe(true);
		expect(sameSize(pixels, { kind: "pixels", width: 4, height: 3 })).toBe(false);
		expect(sameSize(pixels, CANVAS_SIZE)).toBe(false);
	});
});

describe("format queries", () => {
	it("tell how each format is read and written", () => {
		const table = TEXTURE_FORMATS.map((f) => [
			f,
			sampleTypeOf(f),
			scalarOf(f),
			isFilterable(f),
			isStorage(f),
			canMip(f),
			texelBytes(f),
		]);
		expect(table).toEqual([
			["rgba16float", "float", "f32", true, true, true, 8],
			["rg16float", "float", "f32", true, false, true, 4],
			["r16float", "float", "f32", true, false, true, 2],
			["rgba32float", "unfilterable-float", "f32", false, true, true, 16],
			["rg32float", "unfilterable-float", "f32", false, true, true, 8],
			["r32float", "unfilterable-float", "f32", false, true, true, 4],
			["rgba8unorm", "float", "f32", true, true, true, 4],
			["rgba32uint", "uint", "u32", false, true, false, 16],
			["rg32uint", "uint", "u32", false, true, false, 8],
			["r32uint", "uint", "u32", false, true, false, 4],
			["rgba32sint", "sint", "i32", false, true, false, 16],
			["rg32sint", "sint", "i32", false, true, false, 8],
			["r32sint", "sint", "i32", false, true, false, 4],
		]);
		expect(TEXTURE_FORMATS.every(isRenderable)).toBe(true);
	});
});
