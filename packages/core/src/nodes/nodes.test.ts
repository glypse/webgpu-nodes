import { describe, expect, it } from "vitest";

import { formatWgslLiteral } from "../codegen";
import {
	libraryEntry,
	managerFor,
	shaderFor,
	type TestEdge,
	type TestNode,
} from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import { type NodeData, WGSL_TYPES, isConnectionCompatible, type WgslType } from "../types";
import { nodeRegistry } from "./registry";

const SKIPPED = new Set(["frag-output", "node-group"]);

/** Every registered node, each setting option, fed by `declare` nodes of each type. */
function* cases(): Generator<{ name: string; nodes: TestNode[]; edges: TestEdge[] }> {
	for (const [type, descriptor] of Object.entries(nodeRegistry)) {
		if (SKIPPED.has(type) || descriptor.dev) continue;
		const settingVariants: Record<string, string>[] = [{}];
		for (const setting of descriptor.settings ?? []) {
			settingVariants.splice(
				0,
				settingVariants.length,
				...settingVariants.flatMap((v) =>
					setting.options.map((o) => ({ ...v, [setting.key]: o.value })),
				),
			);
		}
		const sourceTypes: readonly (WgslType | null)[] =
			descriptor.inputs.length > 0 ? WGSL_TYPES : [null];
		for (const settings of settingVariants) {
			for (const sourceType of sourceTypes) {
				const nodes: TestNode[] = [
					{ id: "n", type, data: { ...descriptor.defaultData, settings } },
				];
				const edges: TestEdge[] = [];
				if (sourceType) {
					nodes.push({
						id: "src",
						type: "declare",
						data: { types: { declare: sourceType }, values: { x: 1, y: 2 } },
					});
					for (const input of descriptor.inputs) {
						if (input.types.some((t) => isConnectionCompatible(sourceType, t))) {
							edges.push(["src", "value", "n", input.id]);
						}
					}
					if (edges.length === 0) continue;
				}
				const firstOutput = descriptor.outputs[0];
				if (firstOutput) edges.push(["n", firstOutput.id, "out", "color"]);
				const label = Object.values(settings).join(",");
				yield { name: `${type}(${label}) <- ${sourceType ?? "nothing"}`, nodes, edges };
			}
		}
	}
}

describe.skipIf(!nagaBin)("every node generates valid WGSL for every input type", () => {
	for (const { name, nodes, edges } of cases()) {
		it(name, () => {
			const shader = shaderFor(nodes, edges);
			const error = validateFragment(shader);
			expect(error, `${error ?? ""}\n\n${shader}`).toBeNull();
		});
	}
});

describe("formatWgslLiteral", () => {
	it("formats every kind", () => {
		expect(formatWgslLiteral("f32", 1.5)).toBe("f32(1.5)");
		expect(formatWgslLiteral("i32", 2.7)).toBe("i32(2)");
		expect(formatWgslLiteral("u32", -3)).toBe("u32(0)");
		expect(formatWgslLiteral("bool", 1)).toBe("true");
		expect(formatWgslLiteral("vec2b", { x: true, y: false })).toBe("vec2<bool>(true, false)");
		expect(formatWgslLiteral("vec3i", 4)).toBe("vec3i(i32(4))");
		expect(formatWgslLiteral("vec2f", undefined)).toBe("vec2f()");
	});
});

describe("enum inputs and fallbacks", () => {
	const ASPECT_UV = libraryEntry("std-aspect-uv");
	const fn = `group_h_${ASPECT_UV.ref.replace(/[^A-Za-z0-9_]/g, "_")}`;

	const aspectUv = (data: NodeData = {}): TestNode => ({
		id: "a",
		type: "node-group",
		data,
		group: { definitionRef: ASPECT_UV.ref, locked: true },
	});

	it("aspect UV falls back to the fragment UV when unlinked", () => {
		const shader = shaderFor(
			[aspectUv({ values: { mode: 1 } })],
			[["a", "uv", "out", "color"]],
		);
		// The unlinked variant uses the group's own UV, the default branch only.
		expect(shader).toContain(`let v_a = ${fn}__d0(`);
		expect(shader).toMatch(/let v_coordinates = v_uv;/);
		expect(shader).not.toContain(`fn ${fn}(`);
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("uses linked coordinates, one function per linked/unlinked combination", () => {
		const shader = shaderFor(
			[
				{ id: "u", type: "uv" },
				aspectUv(),
				{ ...aspectUv(), id: "b" },
				{ id: "sum", type: "add" },
			],
			[
				["u", "uv", "a", "uv"],
				["a", "uv", "sum", "operands"],
				["b", "uv", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		expect(shader).toContain(`fn ${fn}(`);
		expect(shader).toContain(`fn ${fn}__d0(`);
		expect(shader).toMatch(/let v_coordinates = h_uv;/);
		expect(shader.split(`struct GroupOutputs_${fn.slice("group_".length)} `)).toHaveLength(2);
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("exposes the mode as an enum and the coordinates as a fallback input", () => {
		const graph = managerFor([aspectUv()], []);
		const inputs = graph.resolveNodeInputs("a");
		expect(inputs.find((i) => i.id === "mode")?.control).toEqual({
			kind: "enum",
			options: ["Contain (Fit)", "Cover (Fill)", "Stretch"],
		});
		expect(inputs.find((i) => i.id === "uv")?.fallback).toBe(true);
		expect(inputs.find((i) => i.id === "mode")?.fallback).toBeUndefined();
	});

	it("lets any scalar drive an enum input", () => {
		const shader = shaderFor(
			[{ id: "t", type: "time" }, aspectUv()],
			[
				["t", "time", "a", "mode"],
				["a", "uv", "out", "color"],
			],
		);
		expect(shader).toContain("u32(v_t))");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("picks the default outside groups when nothing feeds the value", () => {
		const shader = shaderFor(
			[
				{ id: "f", type: "fallback" },
				{ id: "t", type: "time" },
			],
			[
				["t", "time", "f", "default"],
				["f", "result", "out", "color"],
			],
		);
		expect(shader).toContain("let v_f = v_t;");
	});
});

describe("output", () => {
	const declare = (type: WgslType): TestNode => ({
		id: "d",
		type: "declare",
		data: { types: { declare: type }, values: { x: 0.25, y: 0.5, z: 0.75, w: 0.5 } },
	});

	it("makes a vec3f opaque instead of padding its alpha with 0", () => {
		const shader = shaderFor([declare("vec3f")], [["d", "value", "out", "color"]]);
		expect(shader).toContain("let v_out = vec4f(v_d, 1.0);");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("keeps a vec4f's alpha", () => {
		const shader = shaderFor([declare("vec4f")], [["d", "value", "out", "color"]]);
		expect(shader).toContain("let v_out = v_d;");
	});

	it("widens narrower values to an opaque vec3f", () => {
		const graph = managerFor([declare("vec2f")], [["d", "value", "out", "color"]]);
		expect(graph.resolveInputType("out", "color")).toBe("vec3f");
	});
});
