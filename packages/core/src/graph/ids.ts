/** Makes the ids of everything the model creates: nodes, links, definitions, items, variables, frames, assets. */
export type IdSource = () => string;
export const randomIds: IdSource = () => crypto.randomUUID();
/** Ids `<prefix>1`, `<prefix>2`…, for reproducible runs. */
export function sequentialIds(prefix = "id"): IdSource {
	let n = 0;
	return () => `${prefix}${String(++n)}`;
}
