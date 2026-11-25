import { describe, expect, it } from "bun:test";

import { alignUp, SlotData } from "./slots";

const block = (...values: number[]) => new Float32Array(values).buffer;

describe("alignUp", () => {
	it("rounds up to a multiple", () => {
		expect([alignUp(16, 256), alignUp(256, 256), alignUp(257, 256)]).toEqual([256, 256, 512]);
	});
});

describe("SlotData", () => {
	it("puts each block in a slot of its own, a stride apart", () => {
		const slots = new SlotData(8, 256);
		expect([slots.add(block(1, 2)), slots.add(block(3, 4)), slots.add(block(5, 6))]).toEqual([
			0, 256, 512,
		]);
		const floats = new Float32Array(slots.used.buffer, slots.used.byteOffset, 129 + 64);
		expect([floats[0], floats[1], floats[64], floats[65], floats[128], floats[129]]).toEqual([
			1, 2, 3, 4, 5, 6,
		]);
	});

	it("keeps what's written while it grows", () => {
		const slots = new SlotData(4, 256);
		const offsets = Array.from({ length: 100 }, (_, i) => slots.add(block(i)));
		expect(offsets[99]).toBe(99 * 256);
		const floats = new Float32Array(slots.used.buffer, slots.used.byteOffset, 100 * 64);
		expect(floats[0]).toBe(0);
		expect(floats[50 * 64]).toBe(50);
		expect(floats[99 * 64]).toBe(99);
	});

	it("reuses the last slot for the same block, not an earlier one", () => {
		const slots = new SlotData(4, 256);
		expect(slots.add(block(1))).toBe(0);
		expect(slots.add(block(1))).toBe(0);
		expect(slots.add(block(2))).toBe(256);
		expect(slots.add(block(1))).toBe(512);
		expect(slots.length).toBe(3);
	});

	it("starts over when reset, leaving nothing used", () => {
		const slots = new SlotData(4, 256);
		slots.add(block(1));
		slots.reset();
		expect(slots.used.length).toBe(0);
		expect(slots.add(block(1))).toBe(0);
	});
});
