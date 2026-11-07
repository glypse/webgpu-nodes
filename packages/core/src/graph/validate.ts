import * as v from "valibot";

import { err, ok, type Result } from "../result";
import { pairedOutputId, REPEAT_INPUT, REPEAT_OUTPUT } from "../zones";
import { type GraphDocument, type GraphProject, ROOT_ID } from "./document";
import { groupRefsOf } from "./editing";
import {
	MAX_CHAIN_LENGTH,
	MAX_DEFINITIONS,
	MAX_GROUP_DEPTH,
	MAX_JSON_BYTES,
	MAX_PROJECT_NODES,
} from "./limits";
import { GraphProjectSchema, type GroupsFile, GroupsFileSchema } from "./schema";

/** A rule of the graph model a file breaks, though its shape is right. */
export type GraphIssue =
	| { kind: "no-root" }
	| { kind: "duplicate-id"; definition: string; id: string }
	| { kind: "dangling-edge"; definition: string; edge: string }
	| { kind: "edge-cycle"; definition: string }
	| { kind: "chain-too-long"; definition: string }
	| { kind: "group-cycle" }
	| { kind: "groups-too-deep" }
	| { kind: "root-instance"; definition: string }
	| { kind: "reserved-definition"; definition: string }
	| { kind: "duplicate-asset"; id: string }
	| { kind: "too-many-definitions" }
	| { kind: "too-many-nodes" };

/** Why a file can't be read. */
export type LoadError =
	| { kind: "too-large"; what: string }
	| { kind: "not-a-bundle" }
	| { kind: "missing-json"; name: string }
	| { kind: "invalid-json" }
	| { kind: "invalid-schema"; issues: string[] }
	| { kind: "invalid-graph"; issues: GraphIssue[] }
	| { kind: "failed"; message: string };

export type LoadResult<T = undefined> = Result<T, LoadError>;

/** A sentence for the user. */
export function describeLoadError(error: LoadError): string {
	switch (error.kind) {
		case "too-large":
			return `It's too large: ${error.what}.`;
		case "not-a-bundle":
			return "It isn't a bundle of this kind.";
		case "missing-json":
			return `The bundle has no ${error.name}.`;
		case "invalid-json":
			return "Its JSON can't be read.";
		case "invalid-schema":
			return "Its contents aren't what this editor saves.";
		case "invalid-graph":
			return "Its graphs break the editor's rules, so it may be damaged or crafted.";
		case "failed":
			return `It couldn't be opened: ${error.message}`;
	}
}

declare const validated: unique symbol;

/** A project of the right shape that keeps every rule `projectIssues` checks. */
export type ValidatedProject = GraphProject & { readonly [validated]: true };

type CheckedDocument = Pick<
	GraphDocument,
	"nodes" | "edges" | "typeVariables" | "inputs" | "outputs"
>;

/**
 * The longest path through a directed graph, in links; undefined when it has
 * a cycle. Iterative: what it checks is what would overflow the stack.
 */
function longestPath(
	ids: Iterable<string>,
	links: Iterable<readonly [string, string]>,
): number | undefined {
	const incoming = new Map<string, number>();
	for (const id of ids) incoming.set(id, 0);
	const next = new Map<string, string[]>();
	for (const [from, to] of links) {
		if (!incoming.has(from) || !incoming.has(to)) continue;
		const targets = next.get(from);
		if (targets) targets.push(to);
		else next.set(from, [to]);
		incoming.set(to, (incoming.get(to) ?? 0) + 1);
	}
	const lengths = new Map<string, number>();
	const ready = [...incoming].flatMap(([id, count]) => (count === 0 ? [id] : []));
	let visited = 0;
	let longest = 0;
	for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
		visited++;
		const length = lengths.get(id) ?? 0;
		longest = Math.max(longest, length);
		for (const target of next.get(id) ?? []) {
			lengths.set(target, Math.max(lengths.get(target) ?? 0, length + 1));
			const left = (incoming.get(target) ?? 0) - 1;
			incoming.set(target, left);
			if (left === 0) ready.push(target);
		}
	}
	return visited === incoming.size ? longest : undefined;
}

function duplicates(ids: readonly string[]): string[] {
	const seen = new Set<string>();
	return ids.filter((id) => seen.size === seen.add(id).size);
}

/** Ids that must differ among themselves, each list on its own. */
function idLists(doc: CheckedDocument): string[][] {
	const ids = (list: readonly { id: string }[] | undefined) => (list ?? []).map((x) => x.id);
	return [
		ids(doc.nodes),
		ids(doc.edges),
		ids(doc.typeVariables),
		ids(doc.inputs),
		ids(doc.outputs),
		...doc.nodes.flatMap((node) => [
			ids(node.data.items),
			ids(node.data.sockets?.inputs),
			ids(node.data.sockets?.outputs),
		]),
	];
}

/** What's wrong within one document, `definition` naming it. */
export function documentIssues(definition: string, doc: CheckedDocument): GraphIssue[] {
	const issues: GraphIssue[] = idLists(doc).flatMap((ids) =>
		duplicates(ids).map((id): GraphIssue => ({ kind: "duplicate-id", definition, id })),
	);

	const nodes = new Set(doc.nodes.map((n) => n.id));
	for (const edge of doc.edges) {
		if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
			issues.push({ kind: "dangling-edge", definition, edge: edge.id });
		}
	}

	// A zone's output depends on its input without a link saying so.
	const outputs = new Set(doc.nodes.filter((n) => n.type === REPEAT_OUTPUT).map((n) => n.id));
	const zones = doc.nodes.flatMap((n): [string, string][] => {
		const output = n.type === REPEAT_INPUT ? pairedOutputId(n) : undefined;
		return output !== undefined && outputs.has(output) ? [[n.id, output]] : [];
	});
	const links = [...doc.edges.map((e) => [e.source, e.target] as const), ...zones];
	const length = longestPath(nodes, links);
	if (length === undefined) issues.push({ kind: "edge-cycle", definition });
	else if (length > MAX_CHAIN_LENGTH) issues.push({ kind: "chain-too-long", definition });

	return issues;
}

/**
 * What's wrong between `definitions`, the user's: standard-library ones can't
 * reference them, so a path ends where it enters the library.
 */
export function referenceIssues(
	definitions: ReadonlyMap<string, Pick<GraphDocument, "nodes">>,
): GraphIssue[] {
	const issues: GraphIssue[] = [];
	if (definitions.size > MAX_DEFINITIONS) issues.push({ kind: "too-many-definitions" });
	const nodes = [...definitions.values()].reduce((sum, doc) => sum + doc.nodes.length, 0);
	if (nodes > MAX_PROJECT_NODES) issues.push({ kind: "too-many-nodes" });
	const links = [...definitions].flatMap(([ref, doc]) =>
		groupRefsOf(doc).map((target) => [ref, target] as const),
	);
	for (const [definition, target] of links) {
		if (target === ROOT_ID) issues.push({ kind: "root-instance", definition });
	}
	const depth = longestPath(definitions.keys(), links);
	if (depth === undefined) issues.push({ kind: "group-cycle" });
	else if (depth > MAX_GROUP_DEPTH) issues.push({ kind: "groups-too-deep" });
	return issues;
}

/** Every rule a saved project keeps; `isLibrary` tells the standard library's refs. */
export function projectIssues(
	project: GraphProject,
	isLibrary: (ref: string) => boolean,
): GraphIssue[] {
	const definitions = Object.entries(project.definitions);
	const issues: GraphIssue[] = [];
	if (!Object.hasOwn(project.definitions, ROOT_ID)) issues.push({ kind: "no-root" });
	// Saves leave the library out: one here would stand in for the app's own.
	for (const [definition] of definitions) {
		if (isLibrary(definition)) issues.push({ kind: "reserved-definition", definition });
	}
	for (const id of duplicates((project.assets ?? []).map((a) => a.id))) {
		issues.push({ kind: "duplicate-asset", id });
	}
	for (const [definition, doc] of definitions) issues.push(...documentIssues(definition, doc));
	return [...issues, ...referenceIssues(new Map(definitions))];
}

function schemaIssues(issues: readonly v.BaseIssue<unknown>[]): string[] {
	return issues.map((issue) => `${v.getDotPath(issue) ?? "(file)"}: ${issue.message}`);
}

/** Check parsed JSON is a project: the only way to a `ValidatedProject`. */
export function validateProject(
	project: unknown,
	isLibrary: (ref: string) => boolean,
): LoadResult<ValidatedProject> {
	const parsed = v.safeParse(GraphProjectSchema, project);
	if (!parsed.success) {
		return err({ kind: "invalid-schema", issues: schemaIssues(parsed.issues) });
	}
	const issues = projectIssues(parsed.output, isLibrary);
	if (issues.length > 0) return err({ kind: "invalid-graph", issues });
	return ok(parsed.output as ValidatedProject);
}

/** JSON text's value, unless it's more than files of ours hold. */
export function parseJson(text: string): LoadResult<unknown> {
	if (text.length > MAX_JSON_BYTES) return err({ kind: "too-large", what: "its JSON" });
	try {
		return ok(JSON.parse(text) as unknown);
	} catch {
		return err({ kind: "invalid-json" });
	}
}

/** The groups of a groups bundle's JSON; `importGroups` checks them against the project. */
export function parseGroups(text: string): LoadResult<GroupsFile> {
	const json = parseJson(text);
	if (!json.ok) return json;
	const parsed = v.safeParse(GroupsFileSchema, json.value);
	if (!parsed.success) {
		return err({ kind: "invalid-schema", issues: schemaIssues(parsed.issues) });
	}
	return ok(parsed.output);
}
