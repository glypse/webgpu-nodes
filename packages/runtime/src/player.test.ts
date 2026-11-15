import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Player } from "./player";

describe("Player", () => {
	const realRequest = globalThis.requestAnimationFrame;
	const realCancel = globalThis.cancelAnimationFrame;
	let requests: FrameRequestCallback[] = [];
	let now = 0;

	function nextFrame() {
		const pending = requests;
		requests = [];
		now += 1000 / 60;
		for (const request of pending) request(now);
	}

	beforeEach(() => {
		requests = [];
		now = 0;
		globalThis.requestAnimationFrame = (callback) => requests.push(callback);
		globalThis.cancelAnimationFrame = () => undefined;
	});

	afterEach(() => {
		globalThis.requestAnimationFrame = realRequest;
		globalThis.cancelAnimationFrame = realCancel;
	});

	it("doesn't draw a frame while the last one isn't finished", async () => {
		const finished = Promise.withResolvers<undefined>();
		let drawn = 0;
		const player = new Player({ fps: 60, realtime: true }, () => {
			drawn += 1;
			return finished.promise;
		});
		player.play();
		nextFrame();
		nextFrame();
		nextFrame();
		expect(drawn).toBe(1);

		finished.resolve(undefined);
		await finished.promise;
		nextFrame();
		expect(drawn).toBe(2);
		player.destroy();
	});

	it("draws up to its limit of frames before one finishes", () => {
		let drawn = 0;
		const player = new Player({ fps: 60, realtime: true }, () => {
			drawn += 1;
			return new Promise(() => undefined);
		});
		player.maxFramesInFlight = 3;
		player.play();
		for (let i = 0; i < 5; i++) nextFrame();
		expect(drawn).toBe(3);
		player.destroy();
	});

	it("draws what was invalidated once a frame finishes, even paused", async () => {
		const finished = Promise.withResolvers<undefined>();
		let drawn = 0;
		const player = new Player({ fps: 60, realtime: true }, () => {
			drawn += 1;
			return finished.promise;
		});
		nextFrame();
		player.invalidate();
		nextFrame();
		expect(drawn).toBe(1);
		expect(requests).toHaveLength(0);

		finished.resolve(undefined);
		await finished.promise;
		expect(requests).toHaveLength(1);
		nextFrame();
		expect(drawn).toBe(2);
		player.destroy();
	});

	it("goes on when finishing a frame fails", async () => {
		const finished = Promise.withResolvers<undefined>();
		let drawn = 0;
		const player = new Player({ fps: 60, realtime: true }, () => {
			drawn += 1;
			return drawn === 1 ? finished.promise : undefined;
		});
		player.play();
		nextFrame();
		finished.reject();
		await finished.promise.catch(() => undefined);
		nextFrame();
		expect(drawn).toBe(2);
		player.destroy();
	});

	it("only counts drawn frames in its rate", () => {
		const finished = Promise.withResolvers<undefined>();
		const player = new Player({ fps: 60, realtime: true }, () => finished.promise);
		player.play();
		for (let i = 0; i < 120; i++) nextFrame();
		expect(player.meter.rate?.fps ?? 0).toBeLessThan(2);
		player.destroy();
	});

	it("keeps its frame when given the timing it has", () => {
		const player = new Player({ fps: 60, realtime: true }, () => undefined);
		// In real time, frames count the display's refreshes rather than follow time.
		player.clock.time = 1;
		player.clock.frame = 100;
		player.setTiming({ fps: 60, realtime: true });
		expect(player.clock.frame).toBe(100);
		player.setTiming({ fps: 30, realtime: true });
		expect(player.clock.frame).toBe(30);
		player.destroy();
	});
});
