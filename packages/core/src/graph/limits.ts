import * as v from "valibot";

/**
 * What a file may ask for. Far above anything drawn by hand, as a project over
 * one of these won't load again, yet low enough that the work a file can cause
 * stays bounded: these keep a few bytes of JSON from hanging the tab.
 */
export const MAX_CASES = 1024;
/** The most a loop counter can reach: WGSL's `i32`. */
export const MAX_ITERATIONS = 2 ** 31 - 1;
export const MAX_DEFINITIONS = 2000;
export const MAX_NODES_PER_DOCUMENT = 20_000;
export const MAX_EDGES_PER_DOCUMENT = 80_000;
export const MAX_PROJECT_NODES = 100_000;
/** Links in a row, which type inference and codegen follow recursively. */
export const MAX_CHAIN_LENGTH = 2000;
/** Groups nested in a row, for the same reason. */
export const MAX_GROUP_DEPTH = 64;
/** Sockets, zone items, curve points, type variables and the like, on one node or document. */
export const MAX_LIST_LENGTH = 1024;
export const MAX_ASSETS = 4096;
export const MAX_ID_LENGTH = 256;
export const MAX_LABEL_LENGTH = 1024;
export const MAX_NOTE_LENGTH = 64 * 1024;
export const MAX_CODE_LENGTH = 1024 * 1024;
export const MAX_JSON_BYTES = 64 * 1024 * 1024;
/** Bundles hold their media whole, so unlike the rest this is about what fits in memory. */
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_ASSET_SIDE = 65536;

/** A number JSON can write back: `1e999` parses to `Infinity`, which saves as `null`. */
export const FiniteSchema = v.pipe(v.number(), v.finite());

export const IdSchema = v.pipe(v.string(), v.maxLength(MAX_ID_LENGTH));

export const LabelSchema = v.pipe(v.string(), v.maxLength(MAX_LABEL_LENGTH));

/** A list of `item`s no longer than `MAX_LIST_LENGTH`. */
export function listOf<T extends v.GenericSchema>(item: T) {
	return v.pipe(v.array(item), v.maxLength(MAX_LIST_LENGTH));
}
