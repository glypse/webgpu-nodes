import { describe, expect, it } from "vitest";

import { History } from "./history.svelte";

describe("History", () => {
	it("undoes and redoes recorded states", () => {
		const history = new History();
		history.reset("a");
		history.record("b");
		history.record("c");
		expect(history.undo()).toBe("b");
		expect(history.undo()).toBe("a");
		expect(history.undo()).toBeUndefined();
		expect(history.redo()).toBe("b");
		expect(history.canRedo).toBe(true);
	});

	it("ignores repeated states and drops the redo branch on new edits", () => {
		const history = new History();
		history.reset("a");
		expect(history.record("a")).toBe(false);
		history.record("b");
		history.undo();
		history.record("c");
		expect(history.canRedo).toBe(false);
		expect(history.undo()).toBe("a");
	});

	it("keeps at most `limit` past states", () => {
		const history = new History(2);
		history.reset("0");
		for (const s of ["1", "2", "3"]) history.record(s);
		expect(history.undoCount).toBe(2);
		expect(history.undo()).toBe("2");
		expect(history.undo()).toBe("1");
		expect(history.undo()).toBeUndefined();
	});
});
