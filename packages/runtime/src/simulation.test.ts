import { describe, expect, it } from "bun:test";

import { nextStep } from "./simulation";

const at = (frame: number, time = frame / 60) => ({ frame, time, delta: 1 / 60 });

describe("nextStep", () => {
	it("starts a simulation that never stepped, by no time", () => {
		expect(nextStep(undefined, at(12))).toEqual({ kind: "start", delta: 0 });
	});

	it("starts over on the first frame", () => {
		expect(nextStep({ frame: 0, time: 0, delta: 0 }, at(0))).toEqual({
			kind: "start",
			delta: 0,
		});
		expect(nextStep({ frame: 40, time: 40 / 60, delta: 1 / 60 }, at(0)).kind).toBe("start");
	});

	it("starts over when time goes back", () => {
		expect(nextStep({ frame: 40, time: 40 / 60, delta: 1 / 60 }, at(10)).kind).toBe("start");
	});

	it("advances by the time since its last step", () => {
		const step = nextStep({ frame: 10, time: 10 / 60, delta: 1 / 60 }, at(13));
		expect(step.kind).toBe("advance");
		expect(step.delta).toBeCloseTo(3 / 60);
	});

	it("computes the same frame again by the same step", () => {
		expect(nextStep({ frame: 10, time: 10 / 60, delta: 0.02 }, at(10))).toEqual({
			kind: "repeat",
			delta: 0.02,
		});
	});
});
