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
			limits: { maxTextureDimension2D: 8192 },
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
	const item = (
		name: string,
		size: Extract<RenderPlan["resources"][number], { kind: "state" }>["size"],
	) => ({
		id: `state:s:${name}:current`,
		kind: "state" as const,
		texture: `state:s:${name}`,
		read: "current" as const,
		format: "r32float" as const,
		size,
		simulation: "s",
	});
	const plan = (...resources: ReturnType<typeof item>[]): RenderPlan => ({
		resources,
		passes: [],
		uniforms: {},
		frame: { steps: [] },
	});
	const canvas = { width: 640, height: 360 };

	it("keeps each item at its own size", () => {
		const { made, state } = fake();
		const half = { kind: "scale", scale: 0.5, of: "canvas" } as const;
		const row = { kind: "pixels", width: 1024, height: 1 } as const;
		state.advance(plan(item("a", half), item("b", row)), at(0), canvas);
		expect(made.map((t) => [t.width, t.height])).toEqual([
			[320, 180],
			[320, 180],
			[1024, 1],
			[1024, 1],
		]);
		const of = { kind: "scale", scale: 0.25, of: { resource: "state:s:a:current" } } as const;
		const { made: more, state: other } = fake();
		other.advance(plan(item("c", of), item("a", half)), at(0), canvas);
		expect(more.map((t) => [t.width, t.height])).toEqual([
			[80, 45],
			[80, 45],
			[320, 180],
			[320, 180],
		]);
	});

	it("starts over when the size an item resolves to changes", () => {
		const { made, state } = fake();
		const row = { kind: "pixels", width: 1024, height: 1 } as const;
		const items = plan(item("a", row));
		expect(state.advance(items, at(0), canvas).get("s")?.kind).toBe("start");
		expect(state.advance(items, at(1), canvas).get("s")?.kind).toBe("advance");
		expect(made.length).toBe(2);
		const wider = plan(item("a", { kind: "pixels", width: 2048, height: 1 }));
		expect(state.advance(wider, at(2), canvas).get("s")?.kind).toBe("start");
		expect(made.slice(0, 2).every((t) => t.destroyed)).toBe(true);
		// Pixels don't follow the canvas; a scale of it does.
		expect(state.advance(wider, at(3), { width: 800, height: 600 }).get("s")?.kind).toBe(
			"advance",
		);
		const scaled = plan(item("a", { kind: "scale", scale: 1, of: "canvas" }));
		state.advance(scaled, at(4), canvas);
		expect(state.advance(scaled, at(5), { width: 800, height: 600 }).get("s")?.kind).toBe(
			"start",
		);
	});
});
