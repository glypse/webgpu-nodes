import { describe, expect, it } from "bun:test";

import {
	type ColorSpace,
	type PassDecl,
	PLAN_TARGET,
	type RenderPlan,
	type ResourceDecl,
	type ShaderProgram,
	type TextureSize,
} from "$core";

import { DependencyCache } from "./loops";
import { PlanWalk } from "./plan-walk";
import type { CompiledProgram } from "./program";
import type { SimulationState } from "./simulation";
import { TexturePool } from "./texture-pool";

const FORMAT = "rgba16float";

const texture = (width: number, height: number) =>
	({
		width,
		height,
		format: FORMAT,
		mipLevelCount: 1,
		destroy: () => undefined,
	}) as unknown as GPUTexture;

const pass = (id: string, reads: string[], writes: string[]): PassDecl => ({
	id,
	kind: "render",
	program: { frameValues: { binding: 2, size: 16, fields: {} } } as unknown as ShaderProgram,
	reads,
	writes,
});

const current = "loop:L:img:current";
const next = "loop:L:img:next";
const final = "loop:L:img:final";
// Half of its own current value; the canvas' for the initial one, which has none.
const size: TextureSize = { kind: "scale", scale: 0.5, of: { resource: current } };
const item = (id: string, read: "current" | "next" | "final"): ResourceDecl => ({
	id,
	kind: "loop",
	texture: "loop:L:img",
	read,
	format: FORMAT,
	size,
	loop: "L",
});

/** Walks a plan, giving the size each pass drew into, by pass id. */
function walk(plan: RenderPlan): Map<string, [number, number][]> {
	const drawn = new Map<string, [number, number][]>();
	const pool = new TexturePool<GPUTexture>(({ width, height }) => texture(width, height));
	const programs = new Map(
		[...plan.passes.flatMap((n) => (n.kind === "loop" ? [...n.start, ...n.next] : [n]))]
			.flatMap((n) => (n.kind === "render" ? [n] : []))
			.map((decl) => [
				decl.id,
				{
					record: (targets: GPUTexture[]) => {
						const sizes = drawn.get(decl.id) ?? [];
						sizes.push([targets[0]?.width ?? 0, targets[0]?.height ?? 0]);
						drawn.set(decl.id, sizes);
						return { targets };
					},
				} as unknown as CompiledProgram,
			]),
	);
	const target = texture(16, 16);
	const frameProgram = plan.frame;
	new PlanWalk({
		plan,
		resources: new Map(plan.resources.map((r) => [r.id, r])),
		frameProgram,
		uniforms: {},
		dependencies: new DependencyCache(frameProgram),
		frame: { time: 0, delta: 0, frame: 0 },
		colorSpace: "srgb" satisfies ColorSpace,
		target,
		maxDimension: 4096,
		defaultFormat: FORMAT,
		programOf: (decl) => {
			const program = programs.get(decl.id);
			if (!program) throw new Error(`no program for ${decl.id}`);
			return program;
		},
		mediaOf: () => target,
		mediaSize: () => undefined,
		emptyTexture: target,
		state: {
			advance: () => new Map(),
			texture: () => undefined,
		} as unknown as SimulationState,
		persistent: (_id, size) => texture(size.width, size.height),
		pool,
	}).run();
	return drawn;
}

describe("PlanWalk", () => {
	const plan: RenderPlan = {
		resources: [
			item(current, "current"),
			item(next, "next"),
			item(final, "final"),
			{
				id: "T",
				kind: "transient",
				size: { kind: "scale", scale: 1, of: { resource: final } },
				format: FORMAT,
			},
		],
		passes: [
			{
				id: "L",
				kind: "loop",
				iterations: 2,
				max: 10,
				items: [{ id: "img", texture: "loop:L:img", format: FORMAT, size }],
				start: [pass("start", [], [current])],
				body: [],
				next: [pass("next", [current], [next])],
			},
			pass("after", [final], ["T"]),
			pass("target", ["T"], [PLAN_TARGET]),
		],
		uniforms: {},
		frame: { steps: [] },
	};

	it("sizes an item like its own current value by the canvas at the start, then by itself", () => {
		const drawn = walk(plan);
		expect(drawn.get("start")).toEqual([[8, 8]]);
		expect(drawn.get("next")).toEqual([
			[4, 4],
			[2, 2],
		]);
	});

	it("sizes a texture like a loop's final value by what the loop ended as, not the canvas", () => {
		// The size is asked for before the loop runs, with no final value to read.
		expect(walk(plan).get("after")).toEqual([[2, 2]]);
	});
});
