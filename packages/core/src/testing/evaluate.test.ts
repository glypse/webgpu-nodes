import { describe, expect, it } from "bun:test";

import { evaluate } from "./evaluate";
import { managerFor } from "./graph";

describe("evaluate", () => {
	it("saturates an f32 linked into an i32 input, as WGSL's conversion does", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "declare", data: { values: { x: 3e9 } } },
				{ id: "sum", type: "add", data: { types: { operands: "i32" } } },
			],
			[["a", "value", "sum", "operands"]],
		);
		expect(evaluate(graph, "sum", "result")).toEqual([2147483647]);
	});

	it("saturates an f32 converted to an integer", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "declare", data: { values: { x: 3e9 } } },
				{ id: "c", type: "to-int" },
			],
			[["a", "value", "c", "e"]],
		);
		expect(evaluate(graph, "c", "result")).toEqual([2147483647]);
	});
});
