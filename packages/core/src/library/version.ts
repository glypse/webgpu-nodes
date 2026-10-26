import type { GraphDocument } from "../graph/document";
import { stableStringify } from "../graph/editing";

/** Separates a standard-library id from its version in a definition ref. */
const VERSION_SEPARATOR = "@";

/** The definition ref of one version of a standard-library entry. */
export function libraryRef(id: string, version: string): string {
	return `${id}${VERSION_SEPARATOR}${version}`;
}

/** The id and version a standard-library ref points at; undefined for other refs. */
export function parseLibraryRef(ref: string): { id: string; version: string } | undefined {
	const at = ref.lastIndexOf(VERSION_SEPARATOR);
	if (at <= 0) return undefined;
	return { id: ref.slice(0, at), version: ref.slice(at + 1) };
}

/**
 * A version id for a standard-library definition, derived from what it
 * computes and exposes: node positions and the camera don't count.
 */
export function libraryVersion(definition: GraphDocument): string {
	return hash(
		stableStringify({
			nodes: definition.nodes.map(({ id, type, data, group }) => ({ id, type, data, group })),
			edges: definition.edges,
			typeVariables: definition.typeVariables,
		}),
	);
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. */
function hash(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const value = 2097152 * (h2 >>> 0) + (h1 >>> 0);
	return value.toString(16).padStart(14, "0");
}
