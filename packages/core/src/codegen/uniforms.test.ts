import { describe, expect, it } from "vitest";

import { generateShader } from ".";
import { ROOT_ID } from "../graph/document";
import { managerFor, type TestEdge, type TestNode } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";

const sine: TestNode[] = [{ id: "s", type: "sin", data: { values: { e: 2 } } }];
const toOutput: TestEdge[] = [["s", "result", "out", "color"]];

describe("uniforms", () => {
	it("reads the scoped document's values from uniforms", () => {
		const { shader, uniforms } = generateShader(managerFor(sine, toOutput), {
			uniformScope: ROOT_ID,
		});
		expect(shader).toContain("sin(spektralUniforms.u_s_e)");
		expect(uniforms).toMatchObject({ u_s_e: 2 });
		if (nagaBin) expect(validateFragment(shader, uniforms)).toBeNull();
	});

	it("keeps the shader when only a value changes", () => {
		const graph = managerFor(sine, toOutput);
		const before = generateShader(graph, { uniformScope: ROOT_ID });
		graph.setInputValue("s", "e", 5);
		const after = generateShader(graph, { uniformScope: ROOT_ID });
		expect(after.shader).toBe(before.shader);
		expect(after.uniforms).toMatchObject({ u_s_e: 5 });
	});

	it("writes values as literals outside the scope", () => {
		const { shader, uniforms } = generateShader(managerFor(sine, toOutput));
		expect(shader).toContain("sin(f32(2))");
		expect(uniforms).toEqual({});
	});

	it("converts float uniforms to integer, boolean and vector inputs", () => {
		const nodes: TestNode[] = [
			{
				id: "i",
				type: "declare",
				data: { types: { declare: "vec3i" }, values: { x: 1, y: -2.7, z: 3 } },
			},
			{ id: "u", type: "declare", data: { types: { declare: "u32" }, values: { x: -4 } } },
			{ id: "b", type: "not", data: { values: { e: true } } },
			{ id: "sw", type: "switch" },
		];
		const edges: TestEdge[] = [
			["b", "result", "sw", "condition"],
			["i", "value", "sw", "true"],
			["u", "value", "sw", "false"],
			["sw", "result", "out", "color"],
		];
		const { shader, uniforms } = generateShader(managerFor(nodes, edges), {
			uniformScope: ROOT_ID,
		});
		expect(uniforms).toMatchObject({ u_i_x: 1, u_i_y: -2, u_u_x: 0, u_b_e: 1 });
		expect(shader).toContain("i32(spektralUniforms.u_i_y)");
		expect(shader).toContain("bool(spektralUniforms.u_b_e)");
		if (nagaBin) expect(validateFragment(shader, uniforms)).toBeNull();
	});

	it("scopes uniforms to a group's definition, used inside its function", () => {
		const graph = managerFor([...sine, { id: "t", type: "time" }], toOutput);
		graph.selectedNodeIds = ["s"];
		graph.groupSelection(new Set(["s"]));
		const group = graph.root.nodes.find((n) => n.type === "node-group");
		const ref = group?.group?.definitionRef ?? "";
		const { shader, uniforms } = generateShader(graph, { uniformScope: ref });
		expect(Object.keys(uniforms)).toEqual(["u_s_e"]);
		expect(shader).toMatch(/fn group_[^]*spektralUniforms\.u_s_e[^]*fn frag/);
		if (nagaBin) expect(validateFragment(shader, uniforms)).toBeNull();

		if (group) graph.enterGroup(group.id);
		expect(graph.activeDefinitionRef).toBe(ref);
	});
});
