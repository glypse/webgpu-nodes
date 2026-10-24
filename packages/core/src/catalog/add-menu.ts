import { ROOT_ID } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { parseLibraryRef } from "../library";
import { nodeRegistry } from "../nodes/registry";
import type { NodeCategory } from "../types";

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
	/**
	 * - `node`: a registered node type (`type`), "node-group" creating a new empty group,
	 * - `group`: an instance of an existing group definition (`definitionRef`),
	 * - `zone`: a new repeat zone (input/output pair).
	 */
	kind: "node" | "group" | "zone";
	type?: string;
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

/** Entries grouped under their heading, keeping order. */
export function groupByHeading(
	entries: readonly AddMenuEntry[],
): { heading: string; entries: AddMenuEntry[] }[] {
	const groups: { heading: string; entries: AddMenuEntry[] }[] = [];
	for (const entry of entries) {
		const group = groups.find((g) => g.heading === entry.heading);
		if (group) group.entries.push(entry);
		else groups.push({ heading: entry.heading, entries: [entry] });
	}
	return groups;
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
