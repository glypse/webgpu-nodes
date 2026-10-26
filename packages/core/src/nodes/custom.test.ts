import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { managerFor, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import { CUSTOM_WGSL, customSockets, isSocketName } from "./custom";

function custom(data: TestNode["data"] = {}): TestNode {
	return { id: "c", type: CUSTOM_WGSL, data };
}

const TWO_OUTPUTS = {
	code: "sum = a + b;\ndiff = vec2f(a - b);",
	sockets: {
		inputs: [
			{ id: "a", label: "a", type: "f32" as const },
			{ id: "b", label: "b", type: "f32" as const },
		],
		outputs: [
			{ id: "sum", label: "sum", type: "f32" as const },
			{ id: "diff", label: "diff", type: "vec2f" as const },
		],
	},
};

describe("Custom WGSL node", () => {
	it("compiles its code into a function returning its outputs", () => {
		const graph = managerFor([custom(TWO_OUTPUTS)], [["c", "sum", "out", "color"]]);
		const { shader, uniforms } = generateShader(graph);
		expect(shader).toContain("var sum: f32;");
		expect(shader).toContain("var diff: vec2f;");
		expect(shader).toMatch(/fn custom_v_c\(a: f32, b: f32\) -> custom_v_c_outputs/);
		if (nagaBin) expect(validateFragment(shader, uniforms)).toBeNull();
	});

	it("validates with the default code and sockets", () => {
		const graph = managerFor([custom()], [["c", "color", "out", "color"]]);
		const { shader, uniforms } = generateShader(graph);
		if (nagaBin) expect(validateFragment(shader, uniforms)).toBeNull();
	});

	it.skipIf(!nagaBin)("leaves invalid code to the shader compiler", () => {
		const graph = managerFor(
			[custom({ ...TWO_OUTPUTS, code: "sum = undefined_name;" })],
			[["c", "sum", "out", "color"]],
		);
		const { shader, uniforms } = generateShader(graph);
		expect(validateFragment(shader, uniforms)).not.toBeNull();
	});

	it("keeps its code and sockets through save and load", async () => {
		const graph = managerFor([custom(TWO_OUTPUTS)], []);
		const loaded = managerFor([], []);
		expect(await loaded.loadFromString(graph.getProjectJson())).toBe(true);
		const node = loaded.root.nodesById.get("c");
		expect(node?.data.code).toBe(TWO_OUTPUTS.code);
		expect(node && customSockets(node.data)).toEqual(TWO_OUTPUTS.sockets);
	});

	it("takes only WGSL identifiers as socket names", () => {
		expect(isSocketName("color")).toBe(true);
		expect(isSocketName("_tmp2")).toBe(true);
		for (const name of ["2x", "a b", "let", "vec3f", "mat4x4", "__x", "_", ""]) {
			expect(isSocketName(name)).toBe(false);
		}
	});

	it("renames sockets to free, valid names only", () => {
		const graph = managerFor([custom(TWO_OUTPUTS)], []);
		expect(graph.renameCustomSocket("c", "inputs", "a", "b")).toBe(false);
		expect(graph.renameCustomSocket("c", "inputs", "a", "fn")).toBe(false);
		expect(graph.renameCustomSocket("c", "inputs", "a", " x ")).toBe(true);
		const node = graph.activeDocument.nodesById.get("c");
		expect(node && customSockets(node.data).inputs[0]?.label).toBe("x");
	});

	it("drops links to removed sockets and to sockets that no longer fit", () => {
		const graph = managerFor(
			[
				custom(TWO_OUTPUTS),
				{ id: "v", type: "declare", data: { types: { declare: "vec4f" } } },
			],
			[
				["v", "value", "c", "a"],
				["c", "diff", "out", "color"],
			],
		);
		graph.setCustomSocketType("c", "inputs", "a", "vec4f");
		expect(graph.activeDocument.edges).toHaveLength(2);
		graph.removeCustomSocket("c", "outputs", "diff");
		expect(graph.activeDocument.edges.map((e) => e.targetHandle)).toEqual(["a"]);
		graph.setCustomSocketType("c", "inputs", "a", "bool");
		expect(graph.activeDocument.edges).toHaveLength(0);
	});
});
