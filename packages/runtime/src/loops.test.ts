import { describe, expect, it } from "bun:test";

import type { FrameProgram } from "$core";

import { clampIterations, DependencyCache, ScopedMemo } from "./loops";

describe("clampIterations", () => {
	it("keeps whole numbers between none and the most", () => {
		expect(clampIterations(5.9, 4096)).toBe(5);
		expect(clampIterations(-3, 4096)).toBe(0);
		expect(clampIterations(1e9, 4096)).toBe(4096);
	});

	it("runs no iterations for what isn't a number", () => {
		expect(clampIterations(Number.NaN, 10)).toBe(0);
		expect(clampIterations(Infinity, 10)).toBe(0);
	});
});

describe("ScopedMemo", () => {
	it("keeps what doesn't depend on an iteration for the whole encode", () => {
		const memo = new ScopedMemo<number>();
		memo.push();
		memo.set("a", 1, false);
		memo.pop();
		expect(memo.get("a")).toBe(1);
	});

	it("forgets what depends on an iteration when it ends", () => {
		const memo = new ScopedMemo<number>();
		memo.push();
		memo.set("a", 1, true);
		expect(memo.get("a")).toBe(1);
		memo.pop();
		memo.push();
		expect(memo.get("a")).toBeUndefined();
	});

	it("reads an outer iteration's values in an inner one, and the inner's own first", () => {
		const memo = new ScopedMemo<number>();
		memo.push();
		memo.set("a", 1, true);
		memo.push();
		expect(memo.get("a")).toBe(1);
		memo.set("a", 2, true);
		expect(memo.get("a")).toBe(2);
		memo.pop();
		expect(memo.get("a")).toBe(1);
	});

	it("keeps nothing that depends on an iteration outside of any", () => {
		const memo = new ScopedMemo<number>();
		memo.set("a", 1, true);
		memo.push();
		expect(memo.get("a")).toBeUndefined();
	});
});

describe("DependencyCache", () => {
	const program: FrameProgram = {
		steps: [
			{ kind: "read", input: { source: "iteration:loop" }, outputs: { value: "f32" } },
			{ kind: "read", input: { source: "time" }, outputs: { value: "f32" } },
		],
	} as unknown as FrameProgram;

	it("finds what the values read, and asks for them once per key", () => {
		const cache = new DependencyCache(program);
		let asked = 0;
		const refs = (step: number) => () => {
			asked++;
			return [{ step, output: "value" }];
		};
		expect([...cache.of("a", refs(0)).loops]).toEqual(["loop"]);
		expect([...cache.of("a", refs(0)).loops]).toEqual(["loop"]);
		expect(cache.of("b", refs(1)).loops.size).toBe(0);
		expect(asked).toBe(2);
	});
});
