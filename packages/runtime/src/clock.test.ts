import { describe, expect, it } from "vitest";

import { Clock } from "./clock";

describe("Clock", () => {
	it("keeps time on the frame grid at a fixed rate", () => {
		const clock = new Clock({ fps: 30, realtime: false });
		expect(clock.tick(1 / 60)).toBe(false);
		expect(clock.tick(1 / 60)).toBe(true);
		expect(clock.frame).toBe(1);
		expect(clock.time).toBe(1 / 30);
		expect(clock.delta).toBe(1 / 30);
	});

	it("skips frames when wall time runs ahead", () => {
		const clock = new Clock({ fps: 24, realtime: false });
		clock.tick(0.25);
		expect(clock.frame).toBe(6);
		expect(clock.time).toBe(0.25);
	});

	it("follows the wall clock in real time, capping stalls", () => {
		const clock = new Clock({ fps: 60, realtime: true });
		clock.tick(0.02);
		clock.tick(5);
		expect(clock.frame).toBe(2);
		expect(clock.time).toBeCloseTo(0.12);
		expect(clock.delta).toBeCloseTo(0.1);
	});

	it("seeks to the frame showing a time", () => {
		const clock = new Clock({ fps: 10, realtime: false });
		clock.seek(1.27);
		expect(clock.frame).toBe(12);
		expect(clock.time).toBe(1.2);
		clock.step(-20);
		expect(clock.frame).toBe(0);
	});

	it("re-snaps when the timing changes", () => {
		const clock = new Clock({ fps: 60, realtime: true });
		clock.seek(0.51);
		clock.setTiming({ fps: 4, realtime: false });
		expect(clock.frame).toBe(2);
		expect(clock.time).toBe(0.5);
	});
});
