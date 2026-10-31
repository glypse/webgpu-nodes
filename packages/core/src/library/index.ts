import * as v from "valibot";

import type { StandardLibraryEntry } from "../graph/document";
import { GraphDocumentSchema, NodeWidgetSchema } from "../graph/schema";
import aspectUv from "./std-aspect-uv.json";
import color from "./std-color.json";
import inDisplayGamut from "./std-in-display-gamut.json";
import linearRgbToOklab from "./std-linear-rgb-to-oklab.json";
import linearRgbToOklch from "./std-linear-rgb-to-oklch.json";
import linearRgbToXyz from "./std-linear-rgb-to-xyz.json";
import oklabToLinearRgb from "./std-oklab-to-linear-rgb.json";
import oklabToOklch from "./std-oklab-to-oklch.json";
import oklabToXyz from "./std-oklab-to-xyz.json";
import oklchGamutMap from "./std-oklch-gamut-map.json";
import oklchToLinearRgb from "./std-oklch-to-linear-rgb.json";
import oklchToOklab from "./std-oklch-to-oklab.json";
import remap from "./std-remap.json";
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
	widget: v.optional(NodeWidgetSchema),
});

const files: unknown[] = [
	aspectUv,
	remap,
	color,
	linearRgbToXyz,
	xyzToLinearRgb,
	xyzToOklab,
	oklabToXyz,
	linearRgbToOklab,
	oklabToLinearRgb,
	oklabToOklch,
	oklchToOklab,
	linearRgbToOklch,
	oklchToLinearRgb,
	inDisplayGamut,
	oklchGamutMap,
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
		...(file.widget ? { widget: file.widget } : {}),
	};
}

/** The standard library, latest versions: group definitions every project can reference. */
export const standardLibrary: readonly StandardLibraryEntry[] = files.map(toEntry);

/** An older version of a standard-library entry, fetched from the archive. */
export async function loadArchivedVersion(ref: string): Promise<StandardLibraryEntry | undefined> {
	const load = archivedVersions[ref];
	return load ? toEntry(await load()) : undefined;
}
