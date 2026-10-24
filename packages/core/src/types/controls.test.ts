import { describe, expect, it } from "vitest";

import { colorNode } from "../nodes";
import { inputControl } from "./controls";

describe("inputControl", () => {
	const [input] = colorNode.inputs;
	if (!input) throw new Error("missing color input");

	it("edits RGB and RGBA inputs as colours", () => {
		expect(inputControl(input, "vec3f")).toEqual({ kind: "color" });
		expect(inputControl(input, "vec4f")).toEqual({ kind: "color" });
	});

	it("falls back to numbers for types a colour doesn't fit", () => {
		expect(inputControl(input, "vec2f")).toEqual({ kind: "number" });
		expect(inputControl(input, "vec3i")).toEqual({ kind: "number" });
	});
});
