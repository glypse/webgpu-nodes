import uFuzzy from "@leeoniya/ufuzzy";

import { type HydratedGraphDocument, ROOT_ID } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { parseLibraryRef } from "../library";
import { hidesLinks } from "../nodes/misc";
import { type NodeType, registeredNodes } from "../nodes/registry";
import {
	enumValue,
	type NodeCategory,
	type NodeData,
	type NodeDescriptor,
	pickableTypes,
	settingValue,
} from "../types";

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
	layout: "Layout",
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
	 * - `zone`: a new repeat zone (input/output pair),
	 * - `link`: a link from a reroute of the document whose links are hidden
	 *   (`source`), or a reroute it feeds.
	 */
	kind: "node" | "group" | "zone" | "link";
	type?: NodeType;
	definitionRef?: string;
	source?: string;
	/** Data the node is created with, over its defaults: a picked type, an enum set. */
	data?: NodeData;
	/**
	 * Choices made when creating it, e.g. its type or an enum: search picks
	 * the options a query names, "Declare vec2i" for "value vec2i", several
	 * at once for "fractal voronoi 3d manhattan".
	 */
	choices: readonly (readonly EntryOption[])[];
	/** Adding it here would make a group contain itself. */
	disabled: boolean;
	/** An unused user group definition, which the menu offers to delete. */
	deletable: boolean;
};

/** An option of one of an entry's choices: `label` names it after the entry's own. */
export type EntryOption = {
	label: string;
	data: NodeData;
	/** It's the option the entry itself is created with. */
	isDefault: boolean;
};

/** `over`'s data over `base`'s, merging their records. */
function mergeData(base: NodeData, over: NodeData): NodeData {
	const { types, settings, values } = over;
	return {
		...base,
		...over,
		...(types && { types: { ...base.types, ...types } }),
		...(settings && { settings: { ...base.settings, ...settings } }),
		...(values && { values: { ...base.values, ...values } }),
	};
}

/** `entry` created with `options` picked, named after them. */
export function withOptions(entry: AddMenuEntry, options: readonly EntryOption[]): AddMenuEntry {
	if (options.length === 0) return entry;
	const labels = options.map((o) => o.label);
	return {
		...entry,
		key: [entry.key, ...labels].join("~"),
		label: [entry.label, ...labels].join(" "),
		data: options.reduce((data, o) => mergeData(data, o.data), entry.data ?? {}),
		choices: [],
	};
}

/**
 * Each choice's options, labelled after the choice's own name where two
 * choices have options of the same label. Choices with one option are dropped.
 */
function choiceOptions(choices: { label: string; options: EntryOption[] }[]): EntryOption[][] {
	const useful = choices.filter((c) => c.options.length > 1);
	const labels = useful.flatMap((c) => c.options.map((o) => o.label));
	const ambiguous = new Set(labels.filter((label, i) => labels.indexOf(label) !== i));
	return useful.map((choice) =>
		choice.options.map((option) => ({
			...option,
			label: ambiguous.has(option.label) ? `${choice.label} ${option.label}` : option.label,
		})),
	);
}

/**
 * A node's type and enum settings. A type picked over one its links would
 * infer is never the default.
 */
function nodeChoices(descriptor: NodeDescriptor): EntryOption[][] {
	const pickable = pickableTypes(descriptor);
	const defaultType = pickable?.inferable
		? undefined
		: (descriptor.defaultData.types?.[pickable?.key ?? ""] ?? pickable?.types[0]);
	return choiceOptions([
		...(pickable
			? [
					{
						label: "Type",
						options: pickable.types.map((type) => ({
							label: type,
							data: { types: { [pickable.key]: type } },
							isDefault: type === defaultType,
						})),
					},
				]
			: []),
		...(descriptor.settings ?? []).map((setting) => {
			const defaultValue = settingValue(descriptor.defaultData, setting);
			return {
				label: setting.label,
				options: setting.options.map((option) => ({
					label: option.label,
					data: { settings: { [setting.key]: option.value } },
					isDefault: option.value === defaultValue,
				})),
			};
		}),
	]);
}

/** A group's type variables and enum inputs (those always shown). */
function groupChoices(definition: HydratedGraphDocument | undefined): EntryOption[][] {
	if (!definition) return [];
	return choiceOptions([
		...definition.typeVariables.map((variable) => ({
			label: variable.name,
			// Inferred from links until picked, like a node's type.
			options: variable.types.map((type) => ({
				label: type,
				data: { types: { [variable.id]: type } },
				isDefault: false,
			})),
		})),
		...definition.inputs.flatMap(({ id, label, variants, owner }) => {
			if (!variants || owner) return [];
			const defaultValue = enumValue(definition.defaults[id], variants);
			return [
				{
					label,
					options: variants.map((variant) => ({
						label: variant.label,
						data: { values: { [id]: variant.value } },
						isDefault: variant.value === defaultValue,
					})),
				},
			];
		}),
	]);
}

const headingOf = (category: string): string =>
	category in CATEGORY_LABELS ? CATEGORY_LABELS[category as NodeCategory] : category;

const NAMED_REROUTES = "Named reroutes";

/**
 * Every entry of the add menu, grouped by heading in menu order: registered
 * nodes and standard-library groups by category, then the user's groups.
 * Developer-tool nodes are only listed with `devTools`.
 */
export function addMenuEntries(
	graph: Pick<
		GraphModel,
		| "library"
		| "project"
		| "wouldCreateCycle"
		| "activeDocument"
		| "activeDefinitionRef"
		| "nodeLabel"
	>,
	{ devTools = false }: { devTools?: boolean } = {},
): AddMenuEntry[] {
	const entries: AddMenuEntry[] = [
		{
			key: "zone:repeat",
			label: "Repeat Zone",
			aliases: ["Loop", "For Loop", "For Each", "Iterate", "While"],
			heading: CATEGORY_LABELS.zone,
			kind: "zone",
			choices: [],
			disabled: false,
			deletable: false,
		},
	];
	for (const [type, descriptor] of registeredNodes()) {
		if (descriptor.hidden || (descriptor.dev && !devTools)) continue;
		entries.push({
			key: `node:${type}`,
			label: descriptor.label,
			aliases: descriptor.aliases ?? [],
			heading: headingOf(descriptor.category),
			kind: "node",
			type,
			choices: nodeChoices(descriptor),
			disabled: false,
			deletable: false,
		});
	}
	// More of a group's boundary nodes, to take or give its values where they're used.
	if (graph.activeDefinitionRef !== ROOT_ID) {
		for (const [type, label, heading, aliases] of [
			["group-input", "Group Input", CATEGORY_LABELS.input, ["Parameters", "Arguments"]],
			["group-output", "Group Output", CATEGORY_LABELS.misc, ["Result", "Return"]],
		] as const) {
			entries.push({
				key: `node:${type}`,
				label,
				aliases,
				heading,
				kind: "node",
				type,
				choices: [],
				disabled: false,
				deletable: false,
			});
		}
	}
	for (const node of graph.activeDocument.nodes) {
		if (!hidesLinks(node)) continue;
		entries.push({
			key: `link:${node.id}`,
			label: graph.nodeLabel(node.id),
			aliases: ["Get", "Named reroute"],
			heading: CATEGORY_LABELS.layout,
			section: [NAMED_REROUTES],
			kind: "link",
			source: node.id,
			choices: [],
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
			choices: groupChoices(graph.project.definitions.get(entry.ref)),
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
			choices: groupChoices(doc),
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
	/** The letters matched in the label, as [start, end) offset pairs. */
	labelRanges: number[];
	/** The letters matched in `alias`, as [start, end) offset pairs. */
	aliasRanges: number[];
};

/** Query words tried in every order, so "vec2i value" finds "Value vec2i". */
const OUT_OF_ORDER = 3;

/** Letters may be skipped within a word: "smst" finds "Smoothstep". */
const insertions = new uFuzzy({ intraIns: Infinity });
/** One typo per word: "smoth" finds "Smoothstep". */
const typos = new uFuzzy({
	// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- SingleError: the enum is ambient only, with no runtime value
	intraMode: 1,
	intraIns: 1,
	intraSub: 1,
	intraTrn: 1,
	intraDel: 1,
});

/** Most combinations of options searched per entry. */
const MAX_COMBINATIONS = 64;

/** A name an entry is searched by, with options picked or none. */
type Candidate = {
	entry: AddMenuEntry;
	/** What it creates: candidates picking the same options, defaults aside, create the same. */
	key: string;
	name: string;
	alias?: string;
	/** Where each picked option's label is, in `name` and in the entry's label. */
	options: { inName: number; inLabel: number; length: number }[];
};

/** Labels of the options a query names: those a word of it matches. */
function namedOptions(entries: readonly AddMenuEntry[], query: string): Set<string> {
	const labels = [...new Set(entries.flatMap((e) => e.choices.flat().map((o) => o.label)))];
	const named = new Set<string>();
	for (const term of insertions.split(query)) {
		for (const fuzzy of [insertions, typos]) {
			for (const i of fuzzy.filter(labels, term) ?? []) named.add(labels[i] ?? "");
		}
	}
	return named;
}

/** Every way of picking, in each choice, none or one of the `named` options. */
function combinations(
	choices: readonly (readonly EntryOption[])[],
	named: ReadonlySet<string>,
): EntryOption[][] {
	let combos: EntryOption[][] = [[]];
	for (const choice of choices) {
		const options = choice.filter((o) => named.has(o.label));
		if (options.length === 0) continue;
		combos = combos
			.flatMap((combo) => [combo, ...options.map((o) => [...combo, o])])
			.slice(0, MAX_COMBINATIONS);
	}
	return combos;
}

function candidatesOf(entry: AddMenuEntry, named: ReadonlySet<string>): Candidate[] {
	const names: { name: string; alias?: string }[] = [
		{ name: entry.label },
		...entry.aliases.map((alias) => ({ name: alias, alias })),
	];
	return combinations(entry.choices, named).flatMap((picked) => {
		const created = withOptions(entry, picked);
		const key = [entry.key, ...picked.filter((o) => !o.isDefault).map((o) => o.label)].join(
			"~",
		);
		return names.map(({ name, alias }) => {
			const options: Candidate["options"] = [];
			let inName = name.length + 1;
			let inLabel = entry.label.length + 1;
			for (const { label } of picked) {
				options.push({ inName, inLabel, length: label.length });
				inName += label.length + 1;
				inLabel += label.length + 1;
			}
			return {
				entry: created,
				key,
				name: [name, ...picked.map((o) => o.label)].join(" "),
				...(alias === undefined ? {} : { alias }),
				options,
			};
		});
	});
}

/** A candidate matching a query, with the letters matched in its name. */
type Hit = { candidate: Candidate; ranges: number[]; tier: number };

/**
 * `candidates` matching `query`, best first. Each is searched by its name
 * then its heading, so "integer not" finds Bitwise Not; `tier` orders them:
 * the label matched letter for letter, then an alias, then each with letters
 * skipped, then those needing the heading.
 */
function rank(fuzzy: uFuzzy, candidates: readonly Candidate[], query: string): Hit[] {
	const [, info, order] = fuzzy.search(
		candidates.map((c) => `${c.name} ${c.entry.heading}`),
		query,
		OUT_OF_ORDER,
		Infinity,
	);
	if (!info) return [];
	return order.flatMap((i) => {
		const candidate = candidates[info.idx[i] ?? -1];
		const all = info.ranges[i];
		if (!candidate || !all) return [];
		const ranges = all.filter((_, j) => (all[j - (j % 2)] ?? 0) < candidate.name.length);
		const inHeading = ranges.length < all.length;
		const skipped = (info.intraIns[i] ?? 0) > 0;
		const tier = (inHeading ? 4 : 0) + (skipped ? 2 : 0) + (candidate.alias ? 1 : 0);
		return [{ candidate, ranges, tier }];
	});
}

/** The result a candidate stands for, its ranges split between label and alias. */
function resultOf({ entry, alias, options }: Candidate, ranges: readonly number[]): SearchResult {
	const labelRanges: number[] = [];
	const aliasRanges: number[] = [];
	for (let i = 0; i + 1 < ranges.length; i += 2) {
		const start = ranges[i] ?? 0;
		const end = ranges[i + 1] ?? 0;
		const option = options.find((o) => start >= o.inName && start < o.inName + o.length);
		if (option) {
			const shift = option.inLabel - option.inName;
			labelRanges.push(start + shift, end + shift);
		} else if (alias === undefined) labelRanges.push(start, end);
		else aliasRanges.push(start, Math.min(end, alias.length));
	}
	return { entry, ...(alias === undefined ? {} : { alias }), labelRanges, aliasRanges };
}

/**
 * Entries matching a search query, best first (see `rank`), then those
 * matching with a typo per word. Options of an entry's choices that the
 * query names are picked, as many at once as it names, when it matches
 * letters of each; those an entry is created with anyway only rename it.
 * `accepts` rules out entries with options picked, e.g. those that can't
 * take a dropped link.
 */
export function searchEntries(
	entries: readonly AddMenuEntry[],
	query: string,
	accepts: (entry: AddMenuEntry) => boolean = () => true,
): SearchResult[] {
	if (query.trim() === "") return [];
	const named = namedOptions(entries, query);
	const candidates = entries.flatMap((entry) => candidatesOf(entry, named));
	const accepted = new Map<string, boolean>();
	const acceptable = ({ entry, options }: Candidate) => {
		if (options.length === 0) return true;
		const known = accepted.get(entry.key);
		if (known !== undefined) return known;
		const ok = accepts(entry);
		accepted.set(entry.key, ok);
		return ok;
	};
	const hits = (fuzzy: uFuzzy) =>
		rank(fuzzy, candidates, query)
			.filter(
				({ candidate, ranges }) =>
					candidate.options.every((o) =>
						ranges.some(
							(at, i) => i % 2 === 0 && at >= o.inName && at < o.inName + o.length,
						),
					) && acceptable(candidate),
			)
			.toSorted((a, b) => a.tier - b.tier);

	const results = new Map<string, { result: SearchResult; picked: number }>();
	for (const { candidate, ranges } of [...hits(insertions), ...hits(typos)]) {
		const found = results.get(candidate.key);
		// More options naming what it creates (defaults) rename it, in place.
		if (!found || candidate.options.length > found.picked) {
			results.set(candidate.key, {
				result: resultOf(candidate, ranges),
				picked: candidate.options.length,
			});
		}
	}
	return [...results.values()].map(({ result }) => result);
}

/** `text` in parts, each matched by `ranges` ([start, end) offset pairs) or not. */
export function highlightParts(
	text: string,
	ranges: readonly number[],
): { text: string; matched: boolean }[] {
	const parts: { text: string; matched: boolean }[] = [];
	let at = 0;
	for (let i = 0; i + 1 < ranges.length; i += 2) {
		const start = ranges[i] ?? 0;
		const end = ranges[i + 1] ?? 0;
		if (start > at) parts.push({ text: text.slice(at, start), matched: false });
		if (end > start) parts.push({ text: text.slice(start, end), matched: true });
		at = Math.max(at, end);
	}
	if (at < text.length) parts.push({ text: text.slice(at), matched: false });
	return parts;
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
