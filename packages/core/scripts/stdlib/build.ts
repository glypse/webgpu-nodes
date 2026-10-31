// Builds standard-library groups described in TypeScript into the library's
// JSON files: checks the WGSL they compile to, lays them out (with the
// editor's measured layout when a browser is given) and registers them.
//
//   bun run stdlib:build <description.ts> [--browser <path>] [--editor <url>] [--dry]
//
// The description's default export is the `GroupSpec`s to build. Without
// --browser, the editor address to open is printed instead.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { generateShader } from "../../src/codegen";
import { type GraphDocument, type GraphProject, ROOT_ID } from "../../src/graph/document";
import { GraphModel } from "../../src/graph/model";
import { libraryRef, libraryVersion, parseLibraryRef, standardLibrary } from "../../src/library";
import { nagaBin, validateFragment } from "../../src/testing/wgsl";
import { GroupBuilder, type GroupSpec, type GroupTarget, type ResolvedGroup } from "./builder";

const coreDir = join(import.meta.dirname, "../..");
const libraryDir = join(coreDir, "src/library");

export type BuiltGroup = ResolvedGroup & {
	spec: GroupSpec;
	definition: GraphDocument;
	dependencies: string[];
	/** Enum inputs and their variants' values, by handle id. */
	enums: Map<string, number[]>;
};

/** Build `specs` and the specs they call, dependencies first. */
export function buildGroups(specs: readonly GroupSpec[]): BuiltGroup[] {
	const byId = new Map(specs.map((s) => [s.id, s]));
	const built = new Map<string, BuiltGroup>();
	const building = new Set<string>();

	const resolveTarget = (target: GroupTarget): ResolvedGroup => {
		if (typeof target !== "string") return build(target);
		const spec = byId.get(target);
		if (spec) return build(spec);
		const entry = standardLibrary.find((e) => e.id === target);
		if (!entry) throw new Error(`no standard-library entry "${target}"`);
		const handles = (type: string) =>
			new Map(
				(entry.definition.nodes.find((n) => n.type === type)?.data.handles ?? []).map(
					(h) => [h.label, h.id],
				),
			);
		return { ref: entry.ref, inputs: handles("group-input"), outputs: handles("group-output") };
	};

	const build = (spec: GroupSpec): BuiltGroup => {
		const done = built.get(spec.id);
		if (done) return done;
		if (building.has(spec.id)) throw new Error(`"${spec.id}" calls itself`);
		building.add(spec.id);
		byId.set(spec.id, spec);
		const g = new GroupBuilder(spec.id, resolveTarget);
		spec.build(g);
		const definition = g.document();
		const group: BuiltGroup = {
			spec,
			definition,
			ref: libraryRef(spec.id, libraryVersion(definition)),
			inputs: g.inputKeys,
			outputs: g.outputKeys,
			dependencies: [...g.dependencies],
			enums: new Map(
				g.inputs.flatMap((h) =>
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
 * other versions of them), and `root` as its root document.
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

/** Every combination of the values of `enums`. */
function combinations(enums: Map<string, number[]>): Record<string, number>[] {
	let result: Record<string, number>[] = [{}];
	for (const [id, values] of enums) {
		result = result.flatMap((combo) => values.map((value) => ({ ...combo, [id]: value })));
	}
	return result;
}

/**
 * Compile a node of each group, reading each output alone and all of them
 * at once with every combination of enum values, and validate the WGSL.
 */
export function validateGroups(groups: readonly BuiltGroup[]): string[] {
	const errors: string[] = [];
	if (!nagaBin)
		console.warn("naga isn't installed: the generated WGSL is only compiled, not validated");
	for (const group of groups) {
		const instance = {
			id: "g",
			type: "node-group",
			position: { x: 0, y: 0 },
			group: { definitionRef: aliasOf(group), locked: true },
		};
		const out = { id: "out", type: "frag-output", data: {}, position: { x: 0, y: 0 } };
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
		for (const values of combinations(group.enums)) {
			cases.push({
				name: `every output, enums ${JSON.stringify(Object.values(values))}`,
				root: {
					nodes: [
						{ ...instance, data: { values } },
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

function writeGroup(group: BuiltGroup) {
	const file = {
		id: group.spec.id,
		name: group.spec.name,
		aliases: group.spec.aliases ?? [],
		category: group.spec.category,
		...(group.spec.section ? { section: group.spec.section } : {}),
		...(group.spec.searchSection ? { searchSection: group.spec.searchSection } : {}),
		dependencies: group.dependencies,
		definition: group.definition,
	};
	writeFileSync(
		join(libraryDir, `${group.spec.id}.json`),
		`${JSON.stringify(file, null, "\t")}\n`,
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
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			browser: { type: "string" },
			editor: { type: "string", default: "http://localhost:5173/editor" },
			dry: { type: "boolean", default: false },
		},
	});
	const [specPath] = positionals;
	if (!specPath || !existsSync(specPath)) {
		console.error(
			"usage: bun run stdlib:build <description.ts> [--browser <path>] [--editor <url>] [--dry]",
		);
		process.exit(1);
	}
	const module = (await import(resolve(specPath))) as { default: GroupSpec[] };
	const groups = buildGroups(module.default);
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
		spawnSync("bun", ["--bun", "oxfmt", join(libraryDir, "index.ts"), ...written], {
			cwd: coreDir,
			stdio: "inherit",
		});
		spawnSync("bun", ["scripts/archive-stdlib.ts"], { cwd: coreDir, stdio: "inherit" });
		for (const stale of staleDependents(groups)) console.warn(`stale: ${stale}`);
	}
	process.exit(0);
}
