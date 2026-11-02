import { describe, expect, it } from "bun:test";

import { generateShader } from "../codegen";
import { caseHandle } from "../enums";
import { evaluate } from "../testing/evaluate";
import { managerFor } from "../testing/graph";
import { nagaBin, validateFragment } from "../testing/wgsl";
import { familyKey, WGSL_TYPES } from "../types";
import { INDEX_SWITCH, INDEX_SWITCH_INDEX } from "./index-switch";

const CASES = [
	{ x: 1, y: 2, z: 3 },
	{ x: 4, y: 5, z: 6 },
	{ x: 7, y: 8, z: 9 },
];

/** An Index Switch of three vec3f cases, its index linked from a Declare holding `index`. */
function graphAt(index: number) {
	return managerFor(
		[
			{
				id: "i",
				type: "declare",
				data: { types: { declare: "i32" }, values: { x: index } },
			},
			{
				id: "s",
				type: INDEX_SWITCH,
				data: {
					cases: CASES.length,
					types: { [familyKey(WGSL_TYPES)]: "vec3f" },
					values: Object.fromEntries(CASES.map((v, k) => [caseHandle(k), v])),
				},
			},
		],
		[
			["i", "value", "s", INDEX_SWITCH_INDEX],
			["s", "result", "out", "color"],
		],
	);
}

describe("Index Switch", () => {
	it("picks the case at its index, the nearest one out of range", () => {
		expect(evaluate(graphAt(1), "s", "result")).toEqual([4, 5, 6]);
		expect(evaluate(graphAt(-3), "s", "result")).toEqual([1, 2, 3]);
		expect(evaluate(graphAt(9), "s", "result")).toEqual([7, 8, 9]);
	});

	it("compiles to a table indexed at runtime", () => {
		const { shader } = generateShader(graphAt(2));
		expect(shader).toContain("array<vec3f, 3>");
		if (nagaBin) expect(validateFragment(shader)).toBeNull();
	});

	it("saves and loads its cases", async () => {
		const graph = graphAt(0);
		const copy = managerFor([], []);
		expect(await copy.loadFromString(graph.getProjectJson())).toBe(true);
		expect(copy.activeDocument.nodesById.get("s")?.data.cases).toBe(CASES.length);
	});

	it("drops the links and values of the cases it loses", () => {
		const graph = managerFor(
			[
				{ id: "s", type: INDEX_SWITCH, data: { cases: 3, values: { [caseHandle(2)]: 5 } } },
				{ id: "t", type: "time" },
			],
			[["t", "seconds", "s", caseHandle(1)]],
		);
		graph.setIndexSwitchCases("s", 1);
		const node = graph.activeDocument.nodesById.get("s");
		expect(node?.data.cases).toBe(1);
		expect(node?.data.values?.[caseHandle(2)]).toBeUndefined();
		expect(graph.activeDocument.edges.some((e) => e.target === "s")).toBe(false);
	});
});
