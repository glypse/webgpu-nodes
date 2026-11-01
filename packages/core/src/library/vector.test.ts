import { describe, expect, it } from "bun:test";

import { generateShader } from "../codegen";
import { evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, managerFor } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import type { WgslType } from "../types";

const VECTORS: [WgslType, number[]][] = [
	["f32", [-2]],
	["vec2f", [-2, 5]],
	["vec3f", [-2, 5, -7]],
	["vec4f", [-2, 5, -7, 3]],
];

/** Output `label` of a node of the library group `id` given `vector` as a `type`. */
function helper(id: string, type: WgslType, vector: number[], label: string) {
	const entry = libraryEntry(id);
	const variable = entry.definition.typeVariables?.[0]?.id ?? "";
	const output = libraryHandle(entry, "group-output", label);
	const [x = 0, y = 0, z = 0, w = 0] = vector;
	const graph = managerFor(
		[
			{
				id: "h",
				type: "node-group",
				group: { definitionRef: entry.ref, locked: true },
				data: {
					types: { [variable]: type },
					values: { [libraryHandle(entry, "group-input", "Vector")]: { x, y, z, w } },
				},
			},
		],
		[["h", output, "out", "color"]],
	);
	const { shader } = generateShader(graph);
	if (nagaBin) expect(validateFragment(shader)).toBeNull();
	return evaluate(graph, "h", output);
}

describe.each(VECTORS)("vector helpers on a %s", (type, vector) => {
	it("pad it with zeros", () => {
		expect(helper("std-pad-vector", type, vector, "Padded")).toEqual(
			[0, 1, 2, 3].map((i) => vector[i] ?? 0),
		);
	});

	it("sum its components", () => {
		expect(helper("std-component-sum", type, vector, "Sum")).toEqual([
			vector.reduce((a, b) => a + b, 0),
		]);
	});

	it("find its largest component", () => {
		expect(helper("std-max-component", type, vector, "Max")).toEqual([Math.max(...vector)]);
	});
});
