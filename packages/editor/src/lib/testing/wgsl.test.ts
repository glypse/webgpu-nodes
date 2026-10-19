import { describe, expect, it } from "vitest";

import { nagaBin, validateFragment } from "./wgsl";

describe.skipIf(!nagaBin)("validateFragment", () => {
	it("accepts a valid fragment", () => {
		expect(
			validateFragment("fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }"),
		).toBeNull();
	});

	it("rejects a type error", () => {
		expect(validateFragment("fn frag(uv: vec2f) -> vec4f { return uv; }")).not.toBeNull();
	});
});
