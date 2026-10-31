import { ROOT_ID } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { parseLibraryRef } from "../library";
import { nodeRegistry } from "../nodes/registry";
import type { NodeCategory, WgslType } from "../types";

/** Category headings, in menu order. */
export const CATEGORY_LABELS: Record<NodeCategory, string> = {
	input: "Input",
	math: "Math",
	vector: "Vector",
	logic: "Logic",
	integer: "Integer",
	converter: "Converter",
	zone: "Zones",
	color: "Color",
	texture: "Texture",
	misc: "Miscellaneous",
};

const GROUPS_HEADING = "Groups";

export type AddMenuEntry = {
	/** Unique across the menu. */
	key: string;
	label: string;
	/** Other names search finds it by (see `NodeDescriptor.aliases`). */
	aliases: readonly string[];
	/** Heading the entry is listed under. */
	heading: string;
	/** Nested sections under the heading the entry is listed in, outermost first. */
	section?: readonly string[];
	/**
	 * Section search results list the entry under, after the main results.
	 * Independent of `section`: an entry deep in the menu can still be a
	 * main result.
	 */
	searchSection?: string;
	/**
	 * - `node`: a registered node type (`type`), "node-group" creating a new empty group,
	 * - `group`: an instance of an existing group definition (`definitionRef`),
	 * - `zone`: a new repeat zone (input/output pair).
	 */
	kind: "node" | "group" | "zone";
	type?: string;
	/** The type a node with a type picker is created with (see `GraphModel.connectableEntries`). */
	forcedType?: WgslType;
	definitionRef?: string;
	/** Adding it here would make a group contain itself. */
	disabled: boolean;
	/** An unused user group definition, which the menu offers to delete. */
	deletable: boolean;
};

const headingOf = (category: string): string =>
	category in CATEGORY_LABELS ? CATEGORY_LABELS[category as NodeCategory] : category;

/**
 * Every entry of the add menu, grouped by heading in menu order: registered
 * nodes and standard-library groups by category, then the user's groups.
 * Developer-tool nodes are only listed with `devTools`.
 */
export function addMenuEntries(
	graph: Pick<GraphModel, "library" | "project" | "wouldCreateCycle">,
	{ devTools = false }: { devTools?: boolean } = {},
): AddMenuEntry[] {
	const entries: AddMenuEntry[] = [
		{
			key: "zone:repeat",
			label: "Repeat Zone",
			aliases: ["Loop", "For Loop", "For Each", "Iterate", "While"],
			heading: CATEGORY_LABELS.zone,
			kind: "zone",
			disabled: false,
			deletable: false,
		},
	];
	for (const [type, descriptor] of Object.entries(nodeRegistry)) {
		if (descriptor.hidden || (descriptor.dev && !devTools)) continue;
		entries.push({
			key: `node:${type}`,
			label: descriptor.label,
			aliases: descriptor.aliases ?? [],
			heading: headingOf(descriptor.category),
			kind: "node",
			type,
			disabled: false,
			deletable: false,
		});
	}
	for (const entry of graph.library) {
		entries.push({
			key: `group:${entry.id}`,
			label: entry.label,
			aliases: entry.aliases,
			heading: headingOf(entry.category),
			...(entry.section.length > 0 ? { section: entry.section } : {}),
			...(entry.searchSection ? { searchSection: entry.searchSection } : {}),
			kind: "group",
			definitionRef: entry.ref,
			disabled: graph.wouldCreateCycle(entry.ref),
			deletable: false,
		});
	}

	// User groups: every non-library definition, used or not (e.g. imported).
	const libraryIds = new Set(graph.library.map((e) => e.id));
	const isLibrary = (ref: string) => libraryIds.has(parseLibraryRef(ref)?.id ?? "");
	const used = new Set<string>();
	for (const doc of graph.project.definitions.values()) {
		for (const node of doc.nodes) {
			if (node.type === "node-group" && node.group) used.add(node.group.definitionRef);
		}
	}
	for (const [ref, doc] of graph.project.definitions) {
		if (ref === ROOT_ID || isLibrary(ref)) continue;
		entries.push({
			key: `group:${ref}`,
			label: doc.label ?? "Group",
			aliases: [],
			heading: GROUPS_HEADING,
			kind: "group",
			definitionRef: ref,
			disabled: graph.wouldCreateCycle(ref),
			deletable: !used.has(ref),
		});
	}

	const order = [...Object.values(CATEGORY_LABELS), GROUPS_HEADING];
	const rank = (heading: string) => {
		const index = order.indexOf(heading);
		return index === -1 ? order.length : index;
	};
	return entries.toSorted((a, b) => rank(a.heading) - rank(b.heading));
}

/** A section of the menu: its entries, then its own sections, each in order. */
export type MenuSection = { name: string; entries: AddMenuEntry[]; sections: MenuSection[] };

/** `entries` in their sections, from `depth` on in their `section` path. */
function sectionsOf(entries: readonly AddMenuEntry[], depth: number): MenuSection[] {
	const names = [...new Set(entries.flatMap((e) => e.section?.[depth] ?? []))];
	return names.map((name) => {
		const inside = entries.filter((e) => e.section?.[depth] === name);
		return {
			name,
			entries: inside.filter((e) => (e.section?.length ?? 0) === depth + 1),
			sections: sectionsOf(inside, depth + 1),
		};
	});
}

/** Entries grouped under their heading, then in their sections, keeping order. */
export function groupByHeading(
	entries: readonly AddMenuEntry[],
): { heading: string; entries: AddMenuEntry[]; sections: MenuSection[] }[] {
	const headings = [...new Set(entries.map((e) => e.heading))];
	return headings.map((heading) => {
		const under = entries.filter((e) => e.heading === heading);
		return {
			heading,
			entries: under.filter((e) => !e.section?.length),
			sections: sectionsOf(under, 0),
		};
	});
}

export type SearchResult = {
	entry: AddMenuEntry;
	/** The alias the query matched, when it matched the entry by one rather than its label. */
	alias?: string;
};

/** Matching by an alias ranks just below matching the label as well. */
const ALIAS_PENALTY = 0.5;

/**
 * Entries matching a search query, best first: names starting with the
 * query, then names with a word starting with it, then names containing it,
 * then entries whose heading matches. Every word of the query must match.
 * The label and each alias are tried separately, the best one counting.
 */
export function searchEntries(entries: readonly AddMenuEntry[], query: string): SearchResult[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const scoreName = (name: string, heading: string): number | undefined => {
		const lower = name.toLowerCase();
		let total = 0;
		for (const word of words) {
			if (lower.startsWith(word)) total += 0;
			else if (lower.split(/[\s/-]+/).some((w) => w.startsWith(word))) total += 1;
			else if (lower.includes(word)) total += 2;
			else if (heading.includes(word)) total += 3;
			else return undefined;
		}
		return total;
	};
	const score = (entry: AddMenuEntry): { s: number; alias?: string } | undefined => {
		const heading = entry.heading.toLowerCase();
		const labelScore = scoreName(entry.label, heading);
		let best: { s: number; alias?: string } | undefined =
			labelScore === undefined ? undefined : { s: labelScore };
		for (const alias of entry.aliases) {
			const aliasScore = scoreName(alias, heading);
			if (aliasScore === undefined) continue;
			const s = aliasScore + ALIAS_PENALTY;
			if (!best || s < best.s) best = { s, alias };
		}
		return best;
	};
	return entries
		.flatMap((entry) => {
			const match = score(entry);
			return match ? [{ entry, ...match }] : [];
		})
		.toSorted((a, b) => a.s - b.s || a.entry.label.localeCompare(b.entry.label))
		.map(({ entry, alias }) => (alias === undefined ? { entry } : { entry, alias }));
}

/**
 * Search results in their search sections: the main results first, then
 * each section's, flattened, keeping the results' order within each.
 */
export function groupResults(
	results: readonly SearchResult[],
): { section?: string; results: SearchResult[] }[] {
	const sections = [undefined, ...new Set(results.flatMap((r) => r.entry.searchSection ?? []))];
	return sections.flatMap((section) => {
		const inside = results.filter((r) => r.entry.searchSection === section);
		if (inside.length === 0) return [];
		return [section === undefined ? { results: inside } : { section, results: inside }];
	});
}
