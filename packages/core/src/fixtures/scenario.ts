import * as v from "valibot";

import { editableScopes, generateRenderPlan } from "../codegen";
import { type Command, COMMANDS } from "../graph/commands";
import type { GraphDocumentEdge } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { GraphProjectSchema } from "../graph/schema";
import { SOCKET_TYPES } from "../types";

/**
 * A scenario is run the way the editor edits: each command is applied to a
 * model built with sequential ids (`id1`, `id2`…), and `recordHistory` is
 * the step the editor's debounced effect records after a change (see
 * `Editor.svelte`). Commands don't record history themselves, so a scenario
 * that checks undo lists `recordHistory` after each edit it means to undo.
 */

/** A value as JSON holds it: what a command takes and what a result gives. */
// `Record` would make this alias circular, which TypeScript refuses.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const JsonSchema: v.GenericSchema<Json> = v.lazy(() =>
	v.union([
		v.string(),
		v.number(),
		v.boolean(),
		v.null(),
		v.array(JsonSchema),
		v.record(v.string(), JsonSchema),
	]),
);

const CommandSchema = v.object({
	kind: v.picklist(COMMANDS),
	args: v.array(JsonSchema),
});

/** `<source>.<sourceHandle> -> <target>.<targetHandle>`, how a link is named in expectations. */
export function linkLabel(edge: GraphDocumentEdge): string {
	return `${edge.source}.${edge.sourceHandle} -> ${edge.target}.${edge.targetHandle}`;
}

const DocumentSchema = v.object({
	/** Node id to node type: the exact set of nodes. */
	nodes: v.optional(v.record(v.string(), v.string())),
	/** The exact set of links, compared sorted. */
	links: v.optional(v.array(v.string())),
	/**
	 * The exact set of invalid links (zone rules and sockets the instance
	 * doesn't have), each with a substring of its reason; "" for any reason.
	 */
	invalidLinks: v.optional(v.record(v.string(), v.string())),
	/** `in:<handle>` or `out:<handle>` to a type, only those listed. */
	types: v.optional(v.record(v.string(), v.record(v.string(), v.picklist(SOCKET_TYPES)))),
	/** Node id to a subset of its data: only the keys listed, recursively. */
	data: v.optional(v.record(v.string(), v.record(v.string(), JsonSchema))),
});
export type DocumentExpectation = v.InferOutput<typeof DocumentSchema>;

/** A definition's interface fields listed, each handle compared on the keys it lists. */
const GroupSchema = v.object({
	inputs: v.optional(v.array(v.record(v.string(), JsonSchema))),
	outputs: v.optional(v.array(v.record(v.string(), JsonSchema))),
	defaults: v.optional(v.record(v.string(), JsonSchema)),
	typeVariables: v.optional(v.array(v.record(v.string(), JsonSchema))),
});

const ExpectSchema = v.object({
	/** One per command, what it returned as JSON (`null` for nothing). */
	results: v.optional(v.array(JsonSchema)),
	/** Keyed by the node-id path of the document, joined with '/', '' for the root. */
	documents: v.optional(v.record(v.string(), DocumentSchema)),
	/** Keyed by definition ref. */
	groups: v.optional(v.record(v.string(), GroupSchema)),
	/** How `generateRenderPlan` fares, as the editor's shader step sees it. */
	codegen: v.optional(v.union([v.literal("ok"), v.object({ refused: v.string() })])),
	/** After undoing every step, the saved project equals the starting one. */
	history: v.optional(v.object({ undoAll: v.literal("start") })),
});
export type Expectation = v.InferOutput<typeof ExpectSchema>;

export const ScenarioSchema = v.object({
	description: v.string(),
	project: GraphProjectSchema,
	commands: v.array(CommandSchema),
	expect: ExpectSchema,
});
export type Scenario = v.InferOutput<typeof ScenarioSchema>;

/** Commands as the model's own types take them, once the schema has checked the JSON. */
export function asCommand(command: Scenario["commands"][number]): Command {
	return command as Command;
}

/** What `observe` found, shaped as the expectation that asked for it. */
export type Observed = {
	results?: Json[];
	documents?: Record<string, Record<string, unknown>>;
	groups?: Record<string, Json | undefined>;
	codegen?: "ok" | { refused: string };
	history?: { undoAll: string };
};

/** What the run did besides the model: the saved project before any command, and what each returned. */
export type Run = { start: string; results: Json[] };

/**
 * The observable state a scenario's expectation names, shaped like the
 * expectation so it compares with `toEqual`. Where an expectation's substring
 * is found in the actual text, the expectation's text is reported, so a
 * mismatch shows the actual text instead.
 */
export function observe(model: GraphModel, expect: Expectation, run: Run): Observed {
	const observed: Observed = {};
	if (expect.results !== undefined) observed.results = run.results;
	if (expect.documents) {
		observed.documents = {};
		for (const [key, wanted] of Object.entries(expect.documents)) {
			const path = key === "" ? [] : key.split("/");
			observed.documents[key] = observeDocument(model, path, wanted);
		}
	}
	if (expect.groups) {
		observed.groups = {};
		for (const [ref, wanted] of Object.entries(expect.groups)) {
			const def = model.project.definitions.get(ref);
			const actual = def
				? (JSON.parse(
						JSON.stringify({
							inputs: def.inputs,
							outputs: def.outputs,
							defaults: def.defaults,
							typeVariables: def.typeVariables,
						}),
					) as Json)
				: undefined;
			observed.groups[ref] = project(actual, wanted);
		}
	}
	if (expect.codegen !== undefined) observed.codegen = observeCodegen(model, expect.codegen);
	if (expect.history !== undefined) {
		observed.history = { undoAll: undoAll(model, run.start) };
	}
	return observed;
}

function observeDocument(
	model: GraphModel,
	path: readonly string[],
	wanted: DocumentExpectation,
): Record<string, unknown> {
	const doc = model.documentAt(path);
	if (path.length > 0 && doc === model.root) {
		throw new Error(`no document at path "${path.join("/")}"`);
	}
	const observed: Record<string, unknown> = {};
	if (wanted.nodes !== undefined) {
		observed.nodes = Object.fromEntries(doc.nodes.map((n) => [n.id, n.type]));
	}
	if (wanted.links !== undefined) {
		observed.links = doc.edges.map(linkLabel).sort();
	}
	if (wanted.invalidLinks !== undefined) {
		observed.invalidLinks = observeInvalid(model, doc, path, wanted.invalidLinks);
	}
	if (wanted.types !== undefined) {
		const types: Record<string, Record<string, string>> = {};
		for (const [nodeId, handles] of Object.entries(wanted.types)) {
			const found: Record<string, string> = {};
			for (const handle of Object.keys(handles)) {
				found[handle] = typeOf(model, nodeId, handle, path);
			}
			types[nodeId] = found;
		}
		observed.types = types;
	}
	if (wanted.data !== undefined) {
		const data: Record<string, unknown> = {};
		for (const [nodeId, fields] of Object.entries(wanted.data)) {
			const node = doc.nodesById.get(nodeId);
			const actual = node ? (JSON.parse(JSON.stringify(node.data)) as Json) : undefined;
			data[nodeId] = project(actual, fields);
		}
		observed.data = data;
	}
	return observed;
}

/**
 * Invalid links of a document: those the zone rules or an instance's
 * sockets make invalid, each with its reason ("" when it has none).
 */
function observeInvalid(
	model: GraphModel,
	doc: ReturnType<GraphModel["documentAt"]>,
	path: readonly string[],
	wanted: Record<string, string>,
): Record<string, string> {
	const zones = model.zoneAnalysis(doc);
	const unavailable = model.unavailableLinks(doc, path);
	const found: Record<string, string> = {};
	for (const edge of doc.edges) {
		if (!zones.invalidEdges.has(edge.id) && !unavailable.has(edge.id)) continue;
		const label = linkLabel(edge);
		const reason = zones.reasons.get(edge.id) ?? "";
		const expected = wanted[label];
		found[label] = expected !== undefined && reason.includes(expected) ? expected : reason;
	}
	return found;
}

function typeOf(model: GraphModel, nodeId: string, handle: string, path: readonly string[]) {
	const [side, id] = splitHandle(handle);
	if (!model.resolveNode(nodeId)) return "no node";
	if (side === "in") return model.resolveInputType(nodeId, id, path);
	return model.resolveOutputHandleType(nodeId, id, path);
}

function splitHandle(handle: string): ["in" | "out", string] {
	if (handle.startsWith("in:")) return ["in", handle.slice(3)];
	if (handle.startsWith("out:")) return ["out", handle.slice(4)];
	throw new Error(`type key "${handle}" must start with "in:" or "out:"`);
}

function observeCodegen(
	model: GraphModel,
	wanted: "ok" | { refused: string },
): "ok" | { refused: string } {
	try {
		generateRenderPlan(model, { uniformScopes: editableScopes(model.project) });
		return "ok";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const expected = typeof wanted === "object" ? wanted.refused : undefined;
		return {
			refused: expected !== undefined && message.includes(expected) ? expected : message,
		};
	}
}

/** Undo until nothing is left to undo: "start" when that's the starting project, else the saved project reached. */
function undoAll(model: GraphModel, start: string): string {
	const limit = 10_000;
	for (let steps = 0; model.history.canUndo; steps++) {
		if (steps === limit) throw new Error("undo did not run out of history");
		model.apply({ kind: "undo", args: [] });
	}
	const reached = model.getProjectJson();
	return reached === start ? "start" : reached;
}

/**
 * The actual value shaped as `wanted`: the keys and array elements `wanted`
 * names, compared as they are; anything else left out.
 */
function project(actual: Json | undefined, wanted: Json): Json | undefined {
	if (isObject(wanted) && isObject(actual)) {
		return Object.fromEntries(
			Object.keys(wanted).flatMap((key) => {
				const shaped = project(actual[key], wanted[key] ?? null);
				return shaped === undefined ? [] : [[key, shaped]];
			}),
		);
	}
	if (Array.isArray(wanted) && Array.isArray(actual)) {
		return actual.map((item, i) => {
			const expected = wanted[i];
			return expected === undefined ? item : (project(item, expected) ?? item);
		});
	}
	return actual;
}

function isObject(value: Json | undefined): value is Record<string, Json> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
