import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
	ARCHIVED_VERSIONS_ENABLED,
	LibraryFileSchema,
	libraryRef,
	libraryVersion,
	standardLibrary,
} from ".";
import { archivedVersions } from "./versions";

const versionsDir = join(import.meta.dirname, "versions");

/** `[id, version]` of every archived file. */
const archived = readdirSync(versionsDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.flatMap((dir) =>
		readdirSync(join(versionsDir, dir.name)).map((file) => [
			dir.name,
			file.replace(/\.json$/, ""),
		]),
	);

describe("standard library", () => {
	it("lists every definition file of the folder", () => {
		const files = readdirSync(import.meta.dirname).filter((f) => f.endsWith(".json"));
		expect(standardLibrary.map((e) => `${e.id}.json`).toSorted()).toEqual(files.toSorted());
	});

	it("names every archived version after its content", async () => {
		for (const [id = "", version = ""] of archived) {
			const json: unknown = JSON.parse(
				readFileSync(join(versionsDir, id, `${version}.json`), "utf8"),
			);
			const file = v.parse(LibraryFileSchema, json);
			expect(libraryVersion(file.definition)).toBe(version);
			expect(file.id).toBe(id);
			expect(await archivedVersions[libraryRef(id, version)]?.()).toEqual(json);
		}
		expect(Object.keys(archivedVersions).toSorted()).toEqual(
			archived.map(([id = "", version = ""]) => libraryRef(id, version)).toSorted(),
		);
	});

	// Run `bun run stdlib:archive` after changing a library file.
	it.skipIf(!ARCHIVED_VERSIONS_ENABLED)("archives the latest version of every entry", () => {
		for (const entry of standardLibrary) expect(archivedVersions).toHaveProperty([entry.ref]);
	});
});
