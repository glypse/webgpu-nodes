import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { readComponent } from "../graph/values";
import { evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, managerFor, type TestEdge } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { NodeData } from "../types";
import { type ColorMode, colorToLinear } from "./modes";

const COLOR = libraryEntry("std-color");
const MODE = libraryHandle(COLOR, "group-input", "Mode");
const [C1, C2, C3] = (["Red", "Green", "Blue"] as const).map((label) =>
	libraryHandle(COLOR, "group-input", label),
) as [string, string, string];
const RGB_OUT = libraryHandle(COLOR, "group-output", "Color");
const RGBA_OUT = libraryHandle(COLOR, "group-output", "RGBA");
const MODES: Record<ColorMode, number> = { rgb: 0, hsv: 1, oklch: 2 };

const color = (data: NodeData = {}) => ({
	id: "c",
	type: "node-group",
	data,
	group: { definitionRef: COLOR.ref, locked: true },
});

const components = (mode: ColorMode, [x, y, z]: [number, number, number]): NodeData => ({
	values: { [MODE]: MODES[mode], [C1]: x, [C2]: y, [C3]: z },
});

const valuesOf = (graph: ReturnType<typeof managerFor>) =>
	[C1, C2, C3].map((c) => readComponent(graph.root.nodesById.get("c")?.data.values?.[c], "_"));

describe("Color group", () => {
	it("names its components after the mode", () => {
		const graph = managerFor([color()], []);
		const labels = () => [C1, C2, C3].map((c) => graph.resolveNodeLabels("c").inputs[c]);
		expect(labels()).toEqual(["Hue", "Saturation", "Value"]);
		graph.setInputValue("c", MODE, MODES.oklch);
		expect(labels()).toEqual(["Lightness", "Chroma", "Hue"]);
		graph.setInputValue("c", MODE, MODES.rgb);
		expect(labels()).toEqual(["Red", "Green", "Blue"]);
	});

	it("draws the colour wheel, but not once cloned", () => {
		const graph = managerFor([color()], []);
		const widget = () => {
			const node = graph.root.nodesById.get("c");
			return node && graph.resolveDescriptor(node).widget;
		};
		expect(widget()).toEqual(
			expect.objectContaining({ kind: "color", mode: MODE, components: [C1, C2, C3] }),
		);
		graph.deepClone("c");
		expect(widget()).toBeUndefined();
	});

	it("converts the components when the mode changes, keeping the colour", () => {
		const graph = managerFor([color(components("hsv", [0.6, 0.5, 0.7]))], []);
		const original = colorToLinear("hsv", [0.6, 0.5, 0.7]);
		for (const mode of ["rgb", "oklch", "hsv"] as const) {
			graph.setInputValue("c", MODE, MODES[mode]);
			const [x = 0, y = 0, z = 0] = valuesOf(graph);
			const linear = colorToLinear(mode, [x, y, z]);
			expect(linear.r).toBeCloseTo(original.r, 5);
			expect(linear.g).toBeCloseTo(original.g, 5);
			expect(linear.b).toBeCloseTo(original.b, 5);
		}
		expect(valuesOf(graph)[0]).toBeCloseTo(0.6, 5);
	});

	it("keeps the hue of a grey through a mode change", () => {
		const graph = managerFor([color(components("hsv", [0.25, 0, 0.5]))], []);
		graph.setInputValue("c", MODE, MODES.oklch);
		expect(valuesOf(graph)[2]).toBeCloseTo(90, 5);
	});

	it("keeps the numbers while a component is linked", () => {
		const graph = managerFor(
			[{ id: "t", type: "time" }, color(components("hsv", [0.6, 0.5, 0.7]))],
			[["t", "time", "c", C1]],
		);
		graph.setInputValue("c", MODE, MODES.rgb);
		expect(valuesOf(graph).slice(1)).toEqual([0.5, 0.7]);
	});

	it("computes the colour of each mode in the shader", () => {
		const cases: [ColorMode, [number, number, number]][] = [
			["rgb", [0.2, 0.4, 0.6]],
			["hsv", [0.6, 0.5, 0.7]],
			["hsv", [0, 0, 0.906]],
			["oklch", [0.7, 0.1, 200]],
		];
		for (const [mode, value] of cases) {
			const graph = managerFor([color({ ...components(mode, value) })], []);
			const { r, g, b } = colorToLinear(mode, value);
			const rgb = evaluate(graph, "c", RGB_OUT);
			// OKLch goes through XYZ, slightly off the picker's straight matrices.
			const digits = mode === "oklch" ? 2 : 5;
			[r, g, b].forEach((n, i) => {
				expect(rgb[i]).toBeCloseTo(n, digits);
			});
			expect(evaluate(graph, "c", RGBA_OUT)[3]).toBe(1);
		}
	});

	it("only compiles the conversion of its mode", () => {
		const shaderOf = (mode: ColorMode) => {
			const edges: TestEdge[] = [["c", RGBA_OUT, "out", "color"]];
			const { shader } = generateShader(
				managerFor([color(components(mode, [0.1, 0.2, 0.3]))], edges),
			);
			if (nagaBin) expect(validateFragment(shader)).toBeNull();
			return shader;
		};
		const oklch = libraryEntry("std-oklab-to-xyz").ref.replace(/[^A-Za-z0-9_]/g, "_");
		expect(shaderOf("rgb")).not.toContain("pow(");
		expect(shaderOf("hsv")).not.toContain(oklch);
		expect(shaderOf("oklch")).toContain(oklch);
	});
});
