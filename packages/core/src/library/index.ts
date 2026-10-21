import * as v from "valibot";

import type { StandardLibraryEntry } from "../graph/document";
import { GraphDocumentSchema } from "../graph/schema";
import aspectUv from "./std-aspect-uv.json";

/** A standard-library file: a locked group definition shipped with the editor. */
const LibraryFileSchema = v.object({
	id: v.string(),
	name: v.string(),
	category: v.string(),
	dependencies: v.array(v.string()),
	definition: GraphDocumentSchema,
});

const files: unknown[] = [aspectUv];

/** The standard library: group definitions every project can reference. */
export const standardLibrary: readonly StandardLibraryEntry[] = files.map((json) => {
	const file = v.parse(LibraryFileSchema, json);
	return {
		id: file.id,
		label: file.name,
		category: file.category,
		dependencies: file.dependencies,
		definition: file.definition,
	};
});
