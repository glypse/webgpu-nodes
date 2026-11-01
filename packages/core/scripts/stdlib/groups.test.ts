import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { GraphDocument } from "../../src/graph/document";
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
			const file = JSON.parse(
				readFileSync(join(libraryDir, `${group.spec.id}.json`), "utf8"),
			) as { definition: GraphDocument; dependencies: string[] };
			expect(unplaced(file.definition)).toEqual(unplaced(group.definition));
			expect(file.dependencies).toEqual(group.dependencies);
		});
	}
});
