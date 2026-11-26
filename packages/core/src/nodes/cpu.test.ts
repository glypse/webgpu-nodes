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

	it("saturate floats converted to integers, as WGSL does", () => {
		const to = (type: "to-int" | "to-uint", x: number) =>
			evaluate(
				managerFor(
					[
						{ id: "a", type: "declare", data: { values: { x } } },
						{ id: "c", type: type },
					],
					[["a", "value", "c", "e"]],
				),
				"c",
				"result",
			);
		expect(to("to-int", 3e9)).toEqual([2147483647]);
		expect(to("to-int", -3e9)).toEqual([-2147483648]);
		expect(to("to-int", Number.NaN)).toEqual([0]);
		expect(to("to-int", -1.5)).toEqual([-1]);
		expect(Object.is(to("to-int", -0.5)[0], 0)).toBe(true);
		expect(Object.is(to("to-uint", -0.5)[0], 0)).toBe(true);
		expect(to("to-uint", -1.5)).toEqual([0]);
		expect(to("to-uint", 5e9)).toEqual([4294967295]);
	});

	it("reflect a vector about a normal", () => {
		const graph = managerFor(
			[
				{
					id: "i",
					type: "declare",
					data: { types: { declare: "vec2f" }, values: { x: 1, y: -1 } },
				},
				{
					id: "n",
					type: "declare",
					data: { types: { declare: "vec2f" }, values: { x: 0, y: 1 } },
				},
				{ id: "r", type: "reflect" },
			],
			[
				["i", "value", "r", "e1"],
				["n", "value", "r", "e2"],
			],
		);
		expect(evaluate(graph, "r", "result")).toEqual([1, 1]);
	});

	it("give 0 for the sign of a negative zero", () => {
		const graph = managerFor(
			[
				{ id: "a", type: "declare", data: { values: { x: -0 } } },
				{ id: "s", type: "sign" },
			],
			[["a", "value", "s", "e"]],
		);
		expect(Object.is(evaluate(graph, "s", "result")[0], 0)).toBe(true);
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
