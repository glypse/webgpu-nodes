import { buildProgram } from "$core";
import { describe, expect, it } from "vitest";

import { packBlock } from "./uniforms";

describe("packBlock", () => {
	it("writes each field at its offset, u32 fields as integers", () => {
		const { frame } = buildProgram("", {});
		const buffer = packBlock(frame, {
			time: 1.5,
			delta: 0.25,
			resolution: [640, 360],
			frame: 7,
		});
		expect([...new Float32Array(buffer, 0, 4)]).toEqual([1.5, 0.25, 640, 360]);
		expect(new Uint32Array(buffer)[4]).toBe(7);
	});

	it("pads vectors and leaves missing values untouched", () => {
		const { uniforms } = buildProgram("", { a: [1, 2, 3], b: 4 });
		const buffer = new ArrayBuffer(uniforms.size);
		new Float32Array(buffer).fill(9);
		packBlock(uniforms, { a: [1, 2, 3] }, buffer);
		// b packs into the vec3's fourth slot.
		expect(uniforms.fields.b?.offset).toBe(12);
		expect([...new Float32Array(buffer)]).toEqual([1, 2, 3, 9]);
	});
});
