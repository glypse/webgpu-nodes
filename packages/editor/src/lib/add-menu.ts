import type { GraphManager } from "./graph-state.svelte";
import { ROOT_ID } from "./graph-types";
import { nodeRegistry } from "./registry";
import type { NodeCategory } from "./types";

// ── "Add node" menu entries ──────────────────────────────────────────────────

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

/** Something the add menu can create. */
export type AddMenuEntry = {
	/** Unique across the menu. */
	key: string;
	label: string;
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
 */
export function addMenuEntries(
	graph: Pick<GraphManager, "library" | "project" | "wouldCreateCycle">,
): AddMenuEntry[] {
	const entries: AddMenuEntry[] = [
		{
			key: "zone:repeat",
			label: "Repeat Zone",
			heading: CATEGORY_LABELS.zone,
			kind: "zone",
			disabled: false,
			deletable: false,
		},
	];
	for (const [type, descriptor] of Object.entries(nodeRegistry)) {
		if (descriptor.hidden) continue;
		entries.push({
			key: `node:${type}`,
			label: descriptor.label,
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
			heading: headingOf(entry.category),
			kind: "group",
			definitionRef: entry.id,
			disabled: graph.wouldCreateCycle(entry.id),
			deletable: false,
		});
	}

	// User groups: every non-library definition, used or not (e.g. imported).
	const libraryIds = new Set(graph.library.map((e) => e.id));
	const used = new Set<string>();
	for (const doc of graph.project.definitions.values()) {
		for (const node of doc.nodes) {
			if (node.type === "node-group" && node.group) used.add(node.group.definitionRef);
		}
	}
	for (const [ref, doc] of graph.project.definitions) {
		if (ref === ROOT_ID || libraryIds.has(ref)) continue;
		entries.push({
			key: `group:${ref}`,
			label: doc.label ?? "Group",
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
