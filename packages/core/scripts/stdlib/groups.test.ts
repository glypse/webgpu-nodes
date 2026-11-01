import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import type { GraphDocument } from "../../src/graph/document";
import { LibraryFileSchema } from "../../src/library";
import { buildGroups } from "./build";
import groups from "./groups";

const libraryDir = join(import.meta.dirname, "../../src/library");

/** A definition as described: where its nodes are is the editor's layout's business. */
const unplaced = (definition: GraphDocument) => ({
	...definition,
	nodes: definition.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
});

describe("standard-library descriptions", () => {
	for (const group of buildGroups(groups)) {
		it(`${group.spec.id} matches its library file`, () => {
			const file = v.parse(
				LibraryFileSchema,
				JSON.parse(readFileSync(join(libraryDir, `${group.spec.id}.json`), "utf8")),
			);
			expect(unplaced(file.definition)).toEqual(unplaced(group.definition));
			expect(file.dependencies).toEqual(group.dependencies);
			expect(file.widget).toEqual(group.widget);
		});
	}
});
