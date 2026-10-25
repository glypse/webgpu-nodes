import * as v from "valibot";

import type { StandardLibraryEntry } from "../graph/document";
import { GraphDocumentSchema } from "../graph/schema";
import aspectUv from "./std-aspect-uv.json";
import linearRgbToXyz from "./std-linear-rgb-to-xyz.json";
import oklabToOklch from "./std-oklab-to-oklch.json";
import oklabToXyz from "./std-oklab-to-xyz.json";
import oklchToOklab from "./std-oklch-to-oklab.json";
import xyzToLinearRgb from "./std-xyz-to-linear-rgb.json";
import xyzToOklab from "./std-xyz-to-oklab.json";
import { libraryRef, libraryVersion } from "./version";
import { archivedVersions } from "./versions";

export * from "./version";

/**
 * Whether projects referencing an older version of a standard-library entry
 * get that version (loaded on demand from the archive) or the latest one.
 */
// TODO: enable once out of alpha, when old project files must keep working.
export const ARCHIVED_VERSIONS_ENABLED = false;

/** A standard-library file: a locked group definition shipped with the editor. */
export const LibraryFileSchema = v.object({
	id: v.string(),
	name: v.string(),
	/** Other names it's found by in the add menu (see `NodeDescriptor.aliases`). */
	aliases: v.optional(v.array(v.string()), []),
	category: v.string(),
	dependencies: v.array(v.string()),
	definition: GraphDocumentSchema,
});

const files: unknown[] = [
	aspectUv,
	linearRgbToXyz,
	xyzToLinearRgb,
	xyzToOklab,
	oklabToXyz,
	oklabToOklch,
	oklchToOklab,
];

function toEntry(json: unknown): StandardLibraryEntry {
	const file = v.parse(LibraryFileSchema, json);
	const version = libraryVersion(file.definition);
	return {
		id: file.id,
		version,
		ref: libraryRef(file.id, version),
		label: file.name,
		aliases: file.aliases,
		category: file.category,
		dependencies: file.dependencies,
		definition: file.definition,
	};
}

/** The standard library, latest versions: group definitions every project can reference. */
export const standardLibrary: readonly StandardLibraryEntry[] = files.map(toEntry);

/** An older version of a standard-library entry, fetched from the archive. */
export async function loadArchivedVersion(ref: string): Promise<StandardLibraryEntry | undefined> {
	const load = archivedVersions[ref];
	return load ? toEntry(await load()) : undefined;
}
