import { describe, expect, it } from "bun:test";

import { FrameMeter } from "./frame-meter";

describe("FrameMeter", () => {
	it("measures the rate once a window has passed", () => {
		const meter = new FrameMeter(1);
		for (let i = 0; i <= 45; i++) {
			meter.record((i * 1000) / 45);
			if (i < 45) expect(meter.rate).toBeUndefined();
		}
		expect(meter.rate?.fps).toBeCloseTo(45);
		expect(meter.rate?.frameTime).toBeCloseTo(1 / 45);
	});

	it("keeps the longest gap between frames", () => {
		const meter = new FrameMeter(1);
		[0, 100, 600, 700, 1000].forEach((t) => {
			meter.record(t);
		});
		expect(meter.rate?.fps).toBeCloseTo(4);
		expect(meter.rate?.worstFrameTime).toBeCloseTo(0.5);
	});

	it("averages the GPU time of the window's frames", () => {
		const meter = new FrameMeter(1);
		meter.recordGpuTime(1);
		meter.record(0);
		meter.recordGpuTime(0.002);
		meter.recordGpuTime(0.004);
		expect(meter.rate).toBeUndefined();
		meter.record(1000);
		expect(meter.rate?.gpuTime).toBeCloseTo(0.003);
		meter.record(2000);
		expect(meter.rate?.gpuTime).toBeUndefined();
	});

	it("starts over after a reset", () => {
		const meter = new FrameMeter(1);
		meter.record(0);
		meter.record(1000);
		meter.reset();
		expect(meter.rate).toBeUndefined();
		meter.record(5000);
		meter.record(5500);
		expect(meter.rate).toBeUndefined();
	});
});
