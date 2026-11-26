import { describe, expect, it } from "bun:test";

import { flushSync } from "svelte";

import { GraphManager } from "./graph-manager.svelte";

/** Count how many times `read` re-runs as an effect while `act` runs. */
function reruns(read: () => unknown, act: () => void): number {
	let runs = 0;
	const stop = $effect.root(() => {
		$effect(() => {
			read();
			runs++;
		});
	});
	flushSync();
	const before = runs;
	act();
	flushSync();
	stop();
	return runs - before;
}

describe("GraphManager reactivity", () => {
	it("loads the default scene into reactive documents", () => {
		const graph = new GraphManager();
		expect(graph.root.nodes.some((n) => n.type === "frag-output")).toBe(true);
		expect(
			reruns(
				() => graph.root.nodes,
				() => graph.apply({ kind: "addNode", args: ["sin", { x: 0, y: 0 }] }),
			),
		).toBe(1);
	});

	it("tracks types, navigation and history", () => {
		const graph = new GraphManager();
		expect(
			reruns(
				() => graph.typeCache,
				() => graph.apply({ kind: "addNode", args: ["sin", { x: 0, y: 0 }] }),
			),
		).toBe(1);
		const group = graph.apply({ kind: "createGroup", args: [{ x: 0, y: 0 }] });
		expect(
			reruns(
				() => graph.activeDocument,
				() => {
					graph.apply({ kind: "enterGroup", args: [group ?? ""] });
				},
			),
		).toBe(1);
		expect(
			reruns(
				() => graph.history.canUndo,
				() => {
					graph.apply({ kind: "exitGroup", args: [] });
					graph.apply({ kind: "recordHistory", args: [] });
				},
			),
		).toBe(1);
		expect(graph.history.canUndo).toBe(true);
	});
});
