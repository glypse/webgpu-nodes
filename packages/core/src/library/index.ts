import type { GraphDocument, StandardLibraryEntry } from "../graph/document";
import aspectUv from "./std-aspect-uv.json";

/** A standard-library file: a locked group definition shipped with the editor. */
type LibraryFile = {
	id: string;
	name: string;
	category: string;
	dependencies: string[];
	definition: GraphDocument;
};

const files: LibraryFile[] = [aspectUv];

/** The standard library: group definitions every project can reference. */
export const standardLibrary: readonly StandardLibraryEntry[] = files.map((file) => ({
	id: file.id,
	label: file.name,
	category: file.category,
	dependencies: file.dependencies,
	definition: file.definition,
}));
