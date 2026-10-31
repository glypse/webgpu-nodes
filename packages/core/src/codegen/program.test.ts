import { describe, expect, it } from "vitest";

import { buildProgram } from "./program";

const FRAG = "fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }";

describe("buildProgram", () => {
	it("lays the frame block out by WGSL's uniform rules", () => {
		const { frame } = buildProgram(FRAG, {});
		expect(frame.fields).toEqual({
			time: { offset: 0, scalar: "f32", components: 1 },
			delta: { offset: 4, scalar: "f32", components: 1 },
			resolution: { offset: 8, scalar: "f32", components: 2 },
			frame: { offset: 16, scalar: "u32", components: 1 },
			display_p3: { offset: 20, scalar: "u32", components: 1 },
		});
		expect(frame.size).toBe(32);
	});

	it("aligns vectors and pads the block to 16 bytes", () => {
		const { uniforms } = buildProgram(FRAG, { a: 1, b: [1, 2, 3], c: [1, 2], d: 4 });
		expect(uniforms.fields.a?.offset).toBe(0);
		expect(uniforms.fields.b?.offset).toBe(16);
		expect(uniforms.fields.c?.offset).toBe(32);
		expect(uniforms.fields.d?.offset).toBe(40);
		expect(uniforms.size).toBe(48);
	});

	it("declares a placeholder when there are no uniforms", () => {
		const { code, uniforms } = buildProgram(FRAG, {});
		expect(Object.keys(uniforms.fields)).toEqual(["unused"]);
		expect(code).toContain("unused: vec4f");
	});
});
