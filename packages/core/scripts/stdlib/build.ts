// Builds standard-library groups described in TypeScript into the library's
// JSON files: checks the WGSL they compile to, lays them out (with the
// editor's measured layout when a browser is given) and registers them.
//
//   bun run stdlib:build [group-id…] [--all] [--browser <path>] [--editor <url>] [--dry]
//
// Every group of groups/ is described, but only those whose library file no
// longer matches its description are built (a group calling one that changed
// changes too), with the groups named, or all of them with --all. Without
// --browser, the editor address to open is printed instead.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { generateShader } from "../../src/codegen";
import {
	type GraphDocument,
	type GraphDocumentNode,
	type GraphProject,
	ROOT_ID,
} from "../../src/graph/document";
import { GraphModel } from "../../src/graph/model";
import {
	type LibraryFile,
	LibraryFileSchema,
	libraryRef,
	libraryVersion,
	parseLibraryRef,
	standardLibrary,
} from "../../src/library";
import { nagaBin, validateFragment } from "../../src/testing/wgsl";
import type { NodeWidget } from "../../src/types";
import { groupBuilder, type GroupSpec, type ResolvedGroup } from "./builder";
import described from "./groups";

const coreDir = join(import.meta.dirname, "../..");
const libraryDir = join(coreDir, "src/library");

export type BuiltGroup = ResolvedGroup & {
	spec: GroupSpec;
	definition: GraphDocument;
	widget?: NodeWidget;
	dependencies: string[];
	/** Enum inputs and their variants' values, by handle id. */
	enums: Map<string, number[]>;
};

/** Keys `spec` declares but `built` lacks, or the other way round. */
function undeclared(side: string, declared: readonly string[], built: Iterable<string>): string[] {
	const keys = new Set(built);
	return [
		...declared.filter((k) => !keys.has(k)).map((k) => `declares ${side} "${k}" but adds none`),
		...[...keys]
			.filter((k) => !declared.includes(k))
			.map((k) => `adds undeclared ${side} "${k}"`),
	];
}

/** Build `specs` and the specs they call, dependencies first. */
export function buildGroups(specs: readonly GroupSpec[]): BuiltGroup[] {
	const built = new Map<string, BuiltGroup>();
	const building = new Set<string>();

	const build = (spec: GroupSpec): BuiltGroup => {
		const done = built.get(spec.id);
		if (done) return done;
		if (building.has(spec.id)) throw new Error(`"${spec.id}" calls itself`);
		building.add(spec.id);
		const g = groupBuilder<string, string>(spec.id, build);
		spec.build(g);
		const mismatches = [
			...undeclared("input", spec.inputs, g.inputKeys.keys()),
			...undeclared("output", spec.outputs, g.outputKeys.keys()),
		];
		if (mismatches.length > 0) throw new Error(`${spec.id}: ${mismatches.join(", ")}`);
		const definition = g.document();
		const inputId = (key: string) => {
			const id = g.inputKeys.get(key);
			if (!id) throw new Error(`${spec.id}: its widget names no input "${key}"`);
			return id;
		};
		const group: BuiltGroup = {
			spec,
			definition,
			...(spec.widget ? { widget: spec.widget(inputId) } : {}),
			ref: libraryRef(spec.id, libraryVersion(definition)),
			inputs: g.inputKeys,
			outputs: g.outputKeys,
			dependencies: [...g.dependencies],
			enums: new Map(
				g.handles.inputs.flatMap((h) =>
					h.variants ? [[h.id, h.variants.map((v) => v.value)]] : [],
				),
			),
		};
		building.delete(spec.id);
		built.set(spec.id, group);
		return group;
	};

	for (const spec of specs) build(spec);
	return [...built.values()];
}

// ── Projects ─────────────────────────────────────────────────────────────

/** The definition key a built group has in projects made here, as a user group. */
const aliasOf = (group: BuiltGroup) => `build-${group.spec.id}`;

/**
 * A project holding `groups` as user groups (the standard library may hold
 * other versions of them), and `root` as its root document. The groups they
 * call are the library's own unless among them.
 */
function projectOf(groups: readonly BuiltGroup[], root: GraphDocument): GraphProject {
	const aliases = new Map(groups.map((g) => [g.ref, aliasOf(g)]));
	const definitions: Record<string, GraphDocument> = { [ROOT_ID]: root };
	for (const group of groups) {
		definitions[aliasOf(group)] = {
			...group.definition,
			label: group.spec.name,
			nodes: group.definition.nodes.map((n) =>
				n.group
					? {
							...n,
							group: {
								...n.group,
								definitionRef:
									aliases.get(n.group.definitionRef) ?? n.group.definitionRef,
							},
						}
					: n,
			),
		};
	}
	return { definitions };
}

/** Every combination of the values of `choices`, by key. */
function combinations<T>(choices: ReadonlyMap<string, readonly T[]>): Record<string, T>[] {
	let result: Record<string, T>[] = [{}];
	for (const [id, values] of choices) {
		result = result.flatMap((combo) => values.map((value) => ({ ...combo, [id]: value })));
	}
	return result;
}

/**
 * Compile a node of each group, reading each output alone and all of them
 * at once with every combination of enum values and variables' types, and
 * validate the WGSL.
 */
export function validateGroups(groups: readonly BuiltGroup[]): string[] {
	const errors: string[] = [];
	if (!nagaBin)
		console.warn("naga isn't installed: the generated WGSL is only compiled, not validated");
	for (const group of groups) {
		const instance: Omit<GraphDocumentNode, "data"> = {
			id: "g",
			type: "node-group",
			position: { x: 0, y: 0 },
			group: { definitionRef: aliasOf(group), locked: true },
		};
		const out: GraphDocumentNode = {
			id: "out",
			type: "frag-output",
			data: {},
			position: { x: 0, y: 0 },
		};
		const cases: { name: string; root: GraphDocument }[] = [];
		for (const [key, handle] of group.outputs) {
			cases.push({
				name: `output "${key}"`,
				root: {
					nodes: [{ ...instance, data: {} }, out],
					edges: [
						{
							id: "e",
							source: "g",
							sourceHandle: handle,
							target: "out",
							targetHandle: "color",
						},
					],
				},
			});
		}
		const variables = new Map(
			(group.definition.typeVariables ?? []).map((v) => [v.id, v.types]),
		);
		const typings = combinations(variables);
		for (const [values, types] of combinations(group.enums).flatMap((values) =>
			typings.map((types) => [values, types] as const),
		)) {
			cases.push({
				name: `every output, enums ${JSON.stringify(Object.values(values))}, types ${JSON.stringify(Object.values(types))}`,
				root: {
					nodes: [
						{ ...instance, data: { values, types } },
						{ id: "sum", type: "add", data: {}, position: { x: 0, y: 0 } },
						out,
					],
					edges: [
						...[...group.outputs.values()].map((handle) => ({
							id: `e-${handle}`,
							source: "g",
							sourceHandle: handle,
							target: "sum",
							targetHandle: "operands",
						})),
						{
							id: "e",
							source: "sum",
							sourceHandle: "result",
							target: "out",
							targetHandle: "color",
						},
					],
				},
			});
		}
		for (const { name, root } of cases) {
			try {
				const { shader } = generateShader(new GraphModel(projectOf(groups, root)));
				const error = nagaBin ? validateFragment(shader) : null;
				if (error) errors.push(`${group.spec.id}, ${name}:\n${error}`);
			} catch (error) {
				errors.push(`${group.spec.id}, ${name}: ${String(error)}`);
			}
		}
	}
	return errors;
}

// ── Layout ───────────────────────────────────────────────────────────────

/** Lay `groups` out with estimated node sizes, in place. */
async function layoutHeadless(groups: readonly BuiltGroup[]) {
	const model = new GraphModel(projectOf(groups, { nodes: [], edges: [] }));
	for (const group of groups) {
		await model.layoutDocument(aliasOf(group));
		takePositions(group, model.project.definitions.get(aliasOf(group))?.nodes ?? []);
	}
}

function takePositions(
	group: BuiltGroup,
	nodes: readonly { id: string; position: { x: number; y: number } }[],
) {
	const positions = new Map(nodes.map((n) => [n.id, n.position]));
	group.definition = {
		...group.definition,
		nodes: group.definition.nodes.map((n) => {
			const p = positions.get(n.id);
			return p ? { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } } : n;
		}),
	};
}

/**
 * Lay `groups` out in the editor, which measures nodes as drawn: serve them
 * as a project, open the editor on it (the dev server must be running) and
 * wait for it to post the laid-out project back.
 */
async function layoutInBrowser(
	groups: readonly BuiltGroup[],
	{ browser, editor }: { browser?: string; editor: string },
) {
	const project = JSON.stringify(projectOf(groups, { nodes: [], edges: [] }));
	const { promise, resolve: done } = Promise.withResolvers<GraphProject>();
	const cors = { "Access-Control-Allow-Origin": "*" };
	const server = Bun.serve({
		port: 0,
		fetch: async (request) => {
			const path = new URL(request.url).pathname;
			if (request.method === "OPTIONS") return new Response(null, { headers: cors });
			if (path === "/project") return new Response(project, { headers: cors });
			if (path === "/result" && request.method === "POST") {
				done((await request.json()) as GraphProject);
				return new Response("ok", { headers: cors });
			}
			return new Response("not found", { status: 404, headers: cors });
		},
	});
	const url = new URL(editor);
	url.searchParams.set("stdlib-layout", `http://localhost:${String(server.port)}/`);
	if (browser) {
		const args =
			process.platform === "darwin" && browser.endsWith(".app")
				? ["open", "-na", browser, "--args", url.href]
				: [browser, url.href];
		spawn(args[0] ?? browser, args.slice(1), { detached: true, stdio: "ignore" }).unref();
		console.log(`Laying out in ${browser}…`);
	} else {
		console.log(`Open this address to lay the groups out:\n${url.href}`);
	}
	const result = await promise;
	await server.stop();
	for (const group of groups)
		takePositions(group, result.definitions[aliasOf(group)]?.nodes ?? []);
}

// ── Files ────────────────────────────────────────────────────────────────

/** The library file `group` is built into. */
function libraryFileOf(group: BuiltGroup): LibraryFile {
	return {
		id: group.spec.id,
		name: group.spec.name,
		aliases: group.spec.aliases ?? [],
		category: group.spec.category,
		...(group.spec.section ? { section: group.spec.section } : {}),
		...(group.spec.searchSection ? { searchSection: group.spec.searchSection } : {}),
		dependencies: group.dependencies,
		definition: group.definition,
		...(group.widget ? { widget: group.widget } : {}),
	};
}

/** The library's file for `id`, if there's one. */
export function readLibraryFile(id: string): LibraryFile | undefined {
	const path = join(libraryDir, `${id}.json`);
	if (!existsSync(path)) return undefined;
	return v.parse(LibraryFileSchema, JSON.parse(readFileSync(path, "utf8")));
}

/** `file` as described: where its nodes are is the layout's business. */
export function unplaced(file: LibraryFile): LibraryFile {
	return {
		...file,
		definition: {
			...file.definition,
			nodes: file.definition.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
		},
	};
}

/** The library file `group` is built into, as the library reads it, its nodes unplaced. */
export function describedFile(group: BuiltGroup): LibraryFile {
	return unplaced(v.parse(LibraryFileSchema, structuredClone(libraryFileOf(group))));
}

/** Whether the library's file for `group` is as it's described. */
function isCurrent(group: BuiltGroup): boolean {
	const file = readLibraryFile(group.spec.id);
	return file !== undefined && Bun.deepEquals(describedFile(group), unplaced(file));
}

function writeGroup(group: BuiltGroup) {
	writeFileSync(
		join(libraryDir, `${group.spec.id}.json`),
		`${JSON.stringify(libraryFileOf(group), null, "\t")}\n`,
	);
}

/** Import a new library file in the library's index, among the others. */
function register(id: string) {
	const indexPath = join(libraryDir, "index.ts");
	const source = readFileSync(indexPath, "utf8");
	const path = `./${id}.json`;
	if (source.includes(`"${path}"`)) return;
	const name = id.replace(/^std-/, "").replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
	const lines = source.split("\n");
	const imports = lines.flatMap((line, i) =>
		/^import \w+ from "\.\/std-.*\.json";$/.test(line) ? [i] : [],
	);
	const after =
		imports.findLast((i) => (lines[i]?.split('"')[1] ?? "") < path) ?? (imports[0] ?? 0) - 1;
	lines.splice(after + 1, 0, `import ${name} from "${path}";`);
	const end = lines.findIndex(
		(line, i) => line === "];" && lines.slice(0, i).some((l) => l.startsWith("const files")),
	);
	lines.splice(end, 0, `\t${name},`);
	writeFileSync(indexPath, lines.join("\n"));
}

/** Library files depending on another version of a group just built. */
function staleDependents(groups: readonly BuiltGroup[]): string[] {
	const latest = new Map(groups.map((g) => [g.spec.id, g.ref]));
	return standardLibrary
		.filter((entry) => !latest.has(entry.id))
		.flatMap((entry) =>
			entry.dependencies
				.filter((ref) => {
					const id = parseLibraryRef(ref)?.id ?? "";
					return latest.has(id) && latest.get(id) !== ref;
				})
				.map((ref) => `${entry.id} depends on ${ref}`),
		);
}

// ── CLI ──────────────────────────────────────────────────────────────────

if (import.meta.main) {
	const usage =
		"usage: bun run stdlib:build [group-id…] [--all] [--browser <path>] [--editor <url>] [--dry]";
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			all: { type: "boolean", default: false },
			browser: { type: "string" },
			editor: { type: "string", default: "http://localhost:5173/editor" },
			dry: { type: "boolean", default: false },
		},
	});
	const all = buildGroups(described);
	const unknown = positionals.filter((id) => !all.some((g) => g.spec.id === id));
	if (unknown.length > 0) {
		console.error(`no group described as ${unknown.join(", ")}\n${usage}`);
		process.exit(1);
	}
	const groups = all.filter(
		(g) => values.all || positionals.includes(g.spec.id) || !isCurrent(g),
	);
	if (groups.length === 0) {
		console.log("Every library file matches its description: nothing to build.");
		process.exit(0);
	}
	for (const g of groups) {
		console.log(
			`${g.ref}: ${String(g.definition.nodes.length)} nodes, ${String(g.definition.edges.length)} links`,
		);
	}

	const errors = validateGroups(groups);
	if (errors.length > 0) {
		console.error(errors.join("\n\n"));
		process.exit(1);
	}

	await layoutHeadless(groups);
	if (!values.dry) {
		await layoutInBrowser(groups, { browser: values.browser, editor: values.editor });
		for (const group of groups) {
			writeGroup(group);
			register(group.spec.id);
		}
		const written = groups.map((g) => join(libraryDir, `${g.spec.id}.json`));
		spawnSync("bun", ["fmt", join(libraryDir, "index.ts"), ...written], {
			cwd: coreDir,
			stdio: "inherit",
		});
		spawnSync("bun", ["scripts/archive-stdlib.ts"], { cwd: coreDir, stdio: "inherit" });
		for (const stale of staleDependents(groups)) console.warn(`stale: ${stale}`);
	}
	process.exit(0);
}
