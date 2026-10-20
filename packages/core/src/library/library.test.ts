import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { standardLibrary } from ".";

describe("standard library", () => {
	it("lists every definition file of the folder", () => {
		const files = readdirSync(import.meta.dirname).filter((f) => f.endsWith(".json"));
		expect(standardLibrary.map((e) => `${e.id}.json`).toSorted()).toEqual(files.toSorted());
	});
});
