import { describe, expect, it } from "vitest";

import { formatWgslLiteral } from "./codegen";
import { nodeRegistry } from "./registry";
import { shaderFor, type TestEdge, type TestNode } from "./testing/graph";
import { nagaBin, validateFragment } from "./testing/wgsl";
import { WGSL_TYPES, isConnectionCompatible, type WgslType } from "./types";

const SKIPPED = new Set(["frag-output", "node-group", "test-invalid-wgsl", "test-runtime-error"]);

/** Every registered node, each setting option, fed by `declare` nodes of each type. */
function* cases(): Generator<{ name: string; nodes: TestNode[]; edges: TestEdge[] }> {
	for (const [type, descriptor] of Object.entries(nodeRegistry)) {
		if (SKIPPED.has(type)) continue;
		const settingVariants: Record<string, unknown>[] = [{}];
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
					{ id: "n", type, data: { ...descriptor.defaultData, ...settings } },
				];
				const edges: TestEdge[] = [];
				if (sourceType) {
					nodes.push({
						id: "src",
						type: "declare",
						data: { declare: sourceType, x: 1, y: 2 },
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
