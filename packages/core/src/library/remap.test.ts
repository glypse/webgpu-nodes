import { describe, expect, it } from "vitest";

import { generateShader } from "../codegen";
import { evaluate } from "../testing/evaluate";
import { type TestNode, libraryEntry, libraryHandle, managerFor } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";

describe("remap", () => {
	const REMAP = libraryEntry("std-remap");
	const input = (label: string) => libraryHandle(REMAP, "group-input", label);
	const RESULT = libraryHandle(REMAP, "group-output", "Result");
	const remap: TestNode = {
		id: "r",
		type: "node-group",
		data: {
			values: {
				[input("Value")]: 0.25,
				[input("From Min")]: -1,
				[input("From Max")]: 1,
				[input("To Min")]: 10,
				[input("To Max")]: 20,
			},
		},
		group: { definitionRef: REMAP.ref, locked: true },
	};

	it("maps a value from one range to another", () => {
		const graph = managerFor([remap], []);
		expect(evaluate(graph, "r", RESULT)[0]).toBeCloseTo(16.25, 6);
	});

	it("maps each component of a vector, taking its type from what's linked", () => {
		const graph = managerFor(
			[
				remap,
				{
					id: "v",
					type: "declare",
					data: { types: { declare: "vec3f" }, values: { x: -1, y: 0, z: 1 } },
				},
			],
			[
				["v", "value", "r", input("Value")],
				["r", RESULT, "out", "color"],
			],
		);
		expect(graph.resolveOutputHandleType("r", RESULT)).toBe("vec3f");
		const [x, y, z] = evaluate(graph, "r", RESULT);
		expect([x, y, z]).toEqual([10, 15, 20]);
		const { shader } = generateShader(graph);
		expect(shader).toContain("t_vec3f(");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});
});
