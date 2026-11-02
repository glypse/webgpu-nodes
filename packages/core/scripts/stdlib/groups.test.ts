import { describe, expect, it } from "bun:test";

import { buildGroups, describedFile, readLibraryFile, unplaced } from "./build";
import groups from "./groups";

describe("standard-library descriptions", () => {
	for (const group of buildGroups(groups)) {
		it(`${group.spec.id} matches its library file`, () => {
			const file = readLibraryFile(group.spec.id);
			expect(file).toBeDefined();
			if (file) expect(describedFile(group)).toEqual(unplaced(file));
		});
	}
});
