import { describe, expect, it } from "vitest";

import { readComponent } from "../graph/values";
import { managerFor, shaderFor } from "../testing/graph";
import { colorToLinear } from "./color";

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

	it("converts the components when the mode changes, keeping the colour", () => {
		const graph = managerFor(
			[{ id: "c", type: "color", data: { values: { c1: 0.6, c2: 0.5, c3: 0.7 } } }],
			[],
		);
		const values = () =>
			(["c1", "c2", "c3"] as const).map((c) =>
				readComponent(graph.root.nodesById.get("c")?.data.values?.[c], "_"),
			);
		const original = colorToLinear("hsv", [0.6, 0.5, 0.7]);
		for (const mode of ["rgb", "oklch", "hsv"] as const) {
			graph.setSetting("c", "mode", mode);
			const [x = 0, y = 0, z = 0] = values();
			const linear = colorToLinear(mode, [x, y, z]);
			expect(linear.r).toBeCloseTo(original.r, 5);
			expect(linear.g).toBeCloseTo(original.g, 5);
			expect(linear.b).toBeCloseTo(original.b, 5);
		}
		expect(values()[0]).toBeCloseTo(0.6, 5);
	});

	it("keeps the hue of a grey through a mode change", () => {
		const graph = managerFor(
			[{ id: "c", type: "color", data: { values: { c1: 0.25, c2: 0, c3: 0.5 } } }],
			[],
		);
		graph.setSetting("c", "mode", "oklch");
		expect(graph.root.nodesById.get("c")?.data.values?.c3).toBeCloseTo(90, 5);
	});

	it("keeps the numbers while a component is linked", () => {
		const graph = managerFor(
			[
				{ id: "t", type: "time" },
				{ id: "c", type: "color", data: { values: { c1: 0.6, c2: 0.5, c3: 0.7 } } },
			],
			[["t", "time", "c", "c1"]],
		);
		graph.setSetting("c", "mode", "rgb");
		expect(graph.root.nodesById.get("c")?.data.values).toMatchObject({ c2: 0.5, c3: 0.7 });
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
