import { describe, expect, it } from "bun:test";

import { mipWeights } from "$core";

/** One level of a row of values, by the weights. */
function reduce(values: readonly number[]): number[] {
	const next = Math.max(1, Math.floor(values.length / 2));
	return Array.from({ length: next }, (_, i) => {
		const { first, weights } = mipWeights(values.length, i);
		return weights.reduce((sum, w, k) => sum + w * (values[first + k] ?? NaN), 0);
	});
}

describe("mipWeights", () => {
	it("sum to one, and give every source texel the same total, for any size", () => {
		for (let size = 1; size <= 64; size++) {
			const m = Math.max(1, Math.floor(size / 2));
			const totals = new Array<number>(size).fill(0);
			for (let i = 0; i < m; i++) {
				const { first, weights } = mipWeights(size, i);
				expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
				expect(first + weights.length).toBeLessThanOrEqual(size);
				weights.forEach((w, k) => (totals[first + k] = (totals[first + k] ?? 0) + w));
			}
			for (const total of totals) expect(total).toBeCloseTo(m / size, 12);
		}
	});

	it("takes pairs of an even size, and three texels of an odd one", () => {
		expect(mipWeights(4, 1)).toEqual({ first: 2, weights: [0.5, 0.5] });
		expect(mipWeights(1, 0)).toEqual({ first: 0, weights: [1] });
		expect(mipWeights(5, 0)).toEqual({ first: 0, weights: [2 / 5, 2 / 5, 1 / 5] });
		expect(mipWeights(5, 1)).toEqual({ first: 2, weights: [1 / 5, 2 / 5, 2 / 5] });
	});

	it("keeps the mean of a ramp at every level of an odd height", () => {
		let level = Array.from({ length: 1081 }, (_, y) => y);
		const mean = (values: readonly number[]) =>
			values.reduce((a, b) => a + b, 0) / values.length;
		const expected = mean(level);
		while (level.length > 1) {
			level = reduce(level);
			expect(mean(level)).toBeCloseTo(expected, 6);
		}
	});

	it("reduces a ramp of height 5 to two texels with its mean", () => {
		const level = reduce([0, 1, 2, 3, 4]);
		expect(level[0]).toBeCloseTo(4 / 5, 12);
		expect(level[1]).toBeCloseTo(16 / 5, 12);
		expect((level[0] ?? 0) / 2 + (level[1] ?? 0) / 2).toBeCloseTo(2, 12);
	});
});
