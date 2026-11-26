import { describe, expect, it } from "bun:test";

import { generateRenderPlan, type LoopDecl, type PassDecl, PLAN_TARGET, planKey } from ".";
import { ROOT_ID } from "../graph/document";
import type { TextureFormat } from "../passes/textures";
import { managerFor, type TestEdge, type TestNode } from "../testing/graph";
import type { ShaderProgram } from "./program";

/** A Render Texture whose `color` item has `format`, drawn by a Sample Texture as the frame. */
function plan(format: TextureFormat, scale = 0.5) {
	const nodes: TestNode[] = [
		{
			id: "rt",
			type: "render-texture",
			data: {
				values: { scale },
				items: [{ id: "color", label: "color", type: "vec4f", format }],
			},
		},
		{ id: "s", type: "sample-texture" },
		{ id: "uv", type: "uv" },
	];
	const edges: TestEdge[] = [
		["uv", "uv", "rt", "color"],
		["rt", "color", "s", "texture"],
		["s", "color", "out", "color"],
	];
	return generateRenderPlan(managerFor(nodes, edges), { uniformScopes: [ROOT_ID] });
}

describe("planKey", () => {
	it("changes with the format of a texture a pass writes, though its code is the same", () => {
		expect(planKey(plan("rgba16float"))).not.toBe(planKey(plan("rgba8unorm")));
	});

	it("is the same for another size, as that is updated without compiling", () => {
		expect(planKey(plan("rgba16float", 0.5))).toBe(planKey(plan("rgba16float", 0.25)));
	});

	it("differs for each format of a texture read by a Load Texel, the shader being the same", () => {
		const keys = new Set(
			(["rgba16float", "rgba8unorm", "rgba32float"] as const).map((format) => {
				const nodes: TestNode[] = [
					{ id: "uv", type: "uv" },
					{
						id: "drawn",
						type: "render-texture",
						data: { items: [{ id: "item", label: "Item", type: "vec4f", format }] },
					},
					{ id: "read", type: "load-texel" },
				];
				const edges: TestEdge[] = [
					["uv", "uv", "drawn", "item"],
					["drawn", "item", "read", "texture"],
					["read", "value", "out", "color"],
				];
				return planKey(generateRenderPlan(managerFor(nodes, edges)));
			}),
		);
		expect(keys.size).toBe(3);
	});

	describe("of a hand-made plan", () => {
		const program = (code: string): ShaderProgram => ({
			code,
			vertexEntry: "vertex_main",
			fragmentEntry: "fragment_main",
			frame: { binding: 0, size: 16, fields: {} },
			uniforms: { binding: 1, size: 16, fields: {} },
			frameValues: { binding: 2, size: 16, fields: {} },
			textures: [],
			samplers: [],
		});
		const pass = (id: string, writes: string[], code = "a"): PassDecl => ({
			id,
			kind: "render",
			program: program(code),
			reads: [],
			writes,
		});
		const base = (iterations: number, scale: number, mips?: true) => {
			const loop: LoopDecl = {
				id: "L",
				kind: "loop",
				iterations,
				max: 10,
				items: [],
				start: [],
				body: [pass("body", ["T"])],
				next: [],
			};
			return {
				resources: [
					{
						id: "T",
						kind: "transient" as const,
						size: { kind: "scale" as const, scale, of: "canvas" as const },
						format: "rgba16float" as const,
						...(mips ? { mips } : {}),
					},
				],
				passes: [loop, pass("target", [PLAN_TARGET])],
				uniforms: { u: scale },
				uniformInputs: new Map(),
				frame: { steps: [] },
			};
		};

		it("is the same for another iteration count, size and uniform", () => {
			expect(planKey(base(2, 0.5))).toBe(planKey(base(7, 0.25)));
		});

		it("changes with a mip chain, a pass id, the code and the order of passes", () => {
			const key = planKey(base(2, 0.5));
			expect(planKey(base(2, 0.5, true))).not.toBe(key);
			const renamed = base(2, 0.5);
			renamed.passes[1] = pass("other", [PLAN_TARGET]);
			expect(planKey(renamed)).not.toBe(key);
			const edited = base(2, 0.5);
			edited.passes[1] = pass("target", [PLAN_TARGET], "b");
			expect(planKey(edited)).not.toBe(key);
			const swapped = base(2, 0.5);
			swapped.passes.reverse();
			expect(planKey(swapped)).not.toBe(key);
		});
	});
});
