import { describe, expect, it } from "vitest";

import { managerFor, shaderFor } from "../testing/graph";

const labels = (graph: ReturnType<typeof managerFor>) =>
	graph.resolveNodeInputs("c").map((i) => `${i.id}:${i.label}`);

describe("Color node", () => {
	it("names its components after the mode, alpha only for RGBA", () => {
		const graph = managerFor([{ id: "c", type: "color" }], []);
		expect(labels(graph)).toEqual(["c1:Hue", "c2:Saturation", "c3:Value"]);
		graph.setSetting("c", "mode", "oklch");
		expect(labels(graph)).toEqual(["c1:Lightness", "c2:Chroma", "c3:Hue"]);
		graph.setNodeType("c", "vec4f");
		expect(labels(graph)).toContain("a:Alpha");
	});

	it("keeps links on their socket when the mode changes", () => {
		const graph = managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "c", type: "color" },
			],
			[["t", "time", "c", "c2"]],
		);
		graph.setSetting("c", "mode", "rgb");
		expect(graph.root.edges).toContainEqual(
			expect.objectContaining({ source: "t", target: "c", targetHandle: "c2" }),
		);
	});

	it("converts to linear RGB in the shader", () => {
		const node = (mode: string) => ({
			id: "c",
			type: "color",
			data: { settings: { mode }, values: { c1: 0.1, c2: 0.2, c3: 0.3 } },
		});
		const toOut: [string, string, string, string][] = [["c", "color", "out", "color"]];
		expect(shaderFor([node("rgb")], toOut)).not.toContain("_hsv");
		expect(shaderFor([node("hsv")], toOut)).toContain("_hsv");
		expect(shaderFor([node("oklch")], toOut)).toContain("_lab");
	});
});
