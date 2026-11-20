import { describe, expect, it } from "bun:test";

import type { RenderPlan } from "$core";

import { nextStep, SimulationState } from "./simulation";

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

describe("SimulationState", () => {
	// Only the flags are read: the device here is a fake.
	globalThis.GPUTextureUsage = {
		RENDER_ATTACHMENT: 16,
		TEXTURE_BINDING: 4,
	} as typeof GPUTextureUsage;
	type Made = { width: number; height: number; destroyed: boolean };
	const fake = () => {
		const made: Made[] = [];
		const device = {
			createTexture: ({ size }: { size: { width: number; height: number } }) => {
				const texture = {
					...size,
					destroyed: false,
					destroy() {
						texture.destroyed = true;
					},
				};
				made.push(texture);
				return texture;
			},
		};
		return { made, state: new SimulationState(device as unknown as GPUDevice) };
	};
	const item = (name: string) => ({
		id: `state:s:${name}:current`,
		kind: "state" as const,
		texture: `state:s:${name}`,
		read: "current" as const,
		format: "r32float" as const,
		size: { kind: "scale", scale: 1, of: "canvas" } as const,
		simulation: "s",
	});
	const plan = (...names: string[]): RenderPlan => ({
		resources: names.map(item),
		passes: [],
		uniforms: {},
		frame: { steps: [] },
	});

	it("keeps each item at the size it's given", () => {
		const { made, state } = fake();
		const sizes: Record<string, { width: number; height: number }> = {
			"state:s:a:current": { width: 320, height: 180 },
			"state:s:b:current": { width: 1024, height: 1 },
		};
		state.advance(plan("a", "b"), at(0), (id) => sizes[id] ?? { width: 1, height: 1 });
		expect(made.map((t) => [t.width, t.height])).toEqual([
			[320, 180],
			[320, 180],
			[1024, 1],
			[1024, 1],
		]);
	});

	it("starts over when the size an item is given changes, and only then", () => {
		const { made, state } = fake();
		const items = plan("a");
		let size = { width: 1024, height: 1 };
		const advance = (frame: number) => state.advance(items, at(frame), () => size);
		expect(advance(0).get("s")?.kind).toBe("start");
		expect(advance(1).get("s")?.kind).toBe("advance");
		expect(made.length).toBe(2);
		size = { width: 2048, height: 1 };
		expect(advance(2).get("s")?.kind).toBe("start");
		expect(made.slice(0, 2).every((t) => t.destroyed)).toBe(true);
		expect(advance(3).get("s")?.kind).toBe("advance");
	});
});
