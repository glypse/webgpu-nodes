import { describe, expect, it } from "vitest";

import { formatWgslLiteral, generateShader } from "../codegen";
import { ROOT_ID } from "../graph/document";
import {
	libraryEntry,
	libraryHandle,
	libraryVar,
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

			// The same with every value read from uniforms.
			const scoped = generateShader(managerFor(nodes, edges), { uniformScope: ROOT_ID });
			const scopedError = validateFragment(scoped.shader, scoped.uniforms);
			expect(scopedError, `${scopedError ?? ""}\n\n${scoped.shader}`).toBeNull();
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
	const UV = libraryHandle(ASPECT_UV, "group-input", "Coordinates");
	const MODE = libraryHandle(ASPECT_UV, "group-input", "Mode");
	const OUT = libraryHandle(ASPECT_UV, "group-output", "Coordinates");
	const coordinates = libraryVar(ASPECT_UV, "fallback");

	const aspectUv = (data: NodeData = {}): TestNode => ({
		id: "a",
		type: "node-group",
		data,
		group: { definitionRef: ASPECT_UV.ref, locked: true },
	});

	it("aspect UV falls back to the fragment UV when unlinked", () => {
		const shader = shaderFor(
			[aspectUv({ values: { [MODE]: 1 } })],
			[["a", OUT, "out", "color"]],
		);
		// The unlinked variant uses the group's own UV, the default branch only.
		expect(shader).toContain(`let v_a = ${fn}__d0__e1_1(`);
		expect(shader).toContain(`let ${coordinates} = ${libraryVar(ASPECT_UV, "uv")};`);
		expect(shader).not.toContain(`fn ${fn}__e1_1(`);
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
				["u", "uv", "a", UV],
				["a", OUT, "sum", "operands"],
				["b", OUT, "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		expect(shader).toContain(`fn ${fn}__e1_0(`);
		expect(shader).toContain(`fn ${fn}__d0__e1_0(`);
		expect(shader).toContain(`let ${coordinates} = h_${UV.replace(/-/g, "_")};`);
		expect(shader.split(`struct GroupOutputs_${fn.slice("group_".length)} `)).toHaveLength(2);
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("only computes the scale of the picked mode", () => {
		const stretch = shaderFor(
			[aspectUv({ values: { [MODE]: 2 } })],
			[["a", OUT, "out", "color"]],
		);
		expect(stretch).not.toContain("spektralFrame.resolution");
		if (nagaBin) expect(validateFragment(stretch)).toBeNull();
		const cover = shaderFor(
			[aspectUv({ values: { [MODE]: 1 } })],
			[["a", OUT, "out", "color"]],
		);
		expect(cover).toContain("spektralFrame.resolution");
	});

	it("exposes the mode as an enum and the coordinates as a fallback input", () => {
		const graph = managerFor([aspectUv()], []);
		const inputs = graph.resolveNodeInputs("a");
		expect(inputs.find((i) => i.id === MODE)?.control).toEqual({
			kind: "enum",
			variants: [
				{ value: 0, label: "Contain (Fit)" },
				{ value: 1, label: "Cover (Fill)" },
				{ value: 2, label: "Stretch" },
			],
		});
		expect(inputs.find((i) => i.id === UV)?.fallback).toBe(true);
		expect(inputs.find((i) => i.id === MODE)?.fallback).toBeUndefined();
	});

	it("lets any scalar drive an enum input", () => {
		const shader = shaderFor(
			[{ id: "t", type: "time" }, aspectUv()],
			[
				["t", "time", "a", MODE],
				["a", OUT, "out", "color"],
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
