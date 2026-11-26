import { describe, expect, it } from "bun:test";

import { generateRenderPlan } from "../codegen/plan";
import { managerFor, type TestEdge, type TestNode } from "../testing/graph";
import { visitUpstream } from "./upstream";

describe("visitUpstream", () => {
	it("visits dependencies before what depends on them, each once, the root left out", () => {
		const deps: Record<string, string[]> = { a: ["b", "c"], b: ["d"], c: ["d"], d: [] };
		const visited: string[] = [];
		visitUpstream(
			"a",
			(n) => deps[n] ?? [],
			() => false,
			(n) => visited.push(n),
		);
		expect(visited).toEqual(["d", "b", "c"]);
	});

	it("doesn't go past what's already done", () => {
		const deps: Record<string, string[]> = { a: ["b"], b: ["c"], c: [] };
		const visited: string[] = [];
		visitUpstream(
			"a",
			(n) => deps[n] ?? [],
			(n) => n === "b",
			(n) => visited.push(n),
		);
		expect(visited).toEqual([]);
	});

	it("lets a chain of 20,000 links be planned without overflowing the stack", () => {
		const n = 20_000;
		const nodes: TestNode[] = [{ id: "c0", type: "declare", data: { values: { x: 0.1 } } }];
		const edges: TestEdge[] = [];
		for (let i = 1; i <= n; i++) {
			nodes.push({ id: `c${String(i)}`, type: "negate" });
			edges.push([`c${String(i - 1)}`, i === 1 ? "value" : "result", `c${String(i)}`, "e"]);
		}
		edges.push([`c${String(n)}`, "result", "out", "color"]);
		expect(() => generateRenderPlan(managerFor(nodes, edges))).not.toThrow();
	}, 30_000);
});
