import { describe, expect, it } from "bun:test";

import { evaluate } from "../testing/evaluate";
import { managerFor } from "../testing/graph";
import { nodeRegistry } from "./registry";

describe("CPU implementations", () => {
	it("round f32 results as the GPU does", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "declare", data: { values: { x: 0.1 } } },
				{ id: "b", type: "declare", data: { values: { x: 0.2 } } },
				{ id: "sum", type: "add" },
			],
			[
				["a", "value", "sum", "operands"],
				["b", "value", "sum", "operands"],
			],
		);
		const [sum = 0] = evaluate(graph, "sum", "result");
		expect(sum).toBe(Math.fround(Math.fround(0.1) + Math.fround(0.2)));
		expect(sum).not.toBe(0.1 + 0.2);
	});

	it("wrap integers as WGSL's do", () => {
		const graph = managerFor(
			[
				{
					id: "a",
					type: "declare",
					data: { types: { declare: "i32" }, values: { x: 2 ** 30 } },
				},
				{ id: "sum", type: "add", data: { types: { operands: "i32" } } },
			],
			[
				["a", "value", "sum", "operands"],
				["a", "value", "sum", "operands"],
				["a", "value", "sum", "operands"],
			],
		);
		expect(evaluate(graph, "sum", "result")).toEqual([-(2 ** 30)]);
	});

	it("are on the nodes with meaning on the CPU only", () => {
		const types = (has: boolean) =>
			Object.values(nodeRegistry)
				.filter((d) => Boolean(d.cpu) === has)
				.map((d) => d.type);
		for (const type of ["add", "sin", "declare", "switch", "color-ramp", "curve", "reroute"]) {
			expect(types(true)).toContain(type);
		}
		for (const type of ["uv", "sample-texture", "custom-wgsl", "image"]) {
			expect(types(false)).toContain(type);
		}
	});
});
