// Builds the project the editor opens with from its description (scene.ts),
// laid out in the editor, as the standard library's groups are.
//
//   bun run scene:build [--browser <path>] [--editor <url>] [--dry]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { generateRenderPlan } from "../../src/codegen";
import { type GraphDocument, type GraphProject, ROOT_ID } from "../../src/graph/document";
import { GraphModel } from "../../src/graph/model";
import { GraphProjectSchema } from "../../src/graph/schema";
import { standardLibrary } from "../../src/library";
import { validatePlan } from "../../src/testing/wgsl";
import { buildGroups, type BuiltGroup, EDITOR_URL, layoutInBrowser } from "../stdlib/build";
import { root } from "./scene";

const coreDir = join(import.meta.dirname, "../..");

/** A group's document with what it calls of the scene's own by its key, unlocked. */
function documentOf(group: BuiltGroup, keys: ReadonlyMap<string, string>): GraphDocument {
	return {
		...group.definition,
		label: group.spec.name,
		nodes: group.definition.nodes.map((node) => {
			const key = node.group && keys.get(node.group.definitionRef);
			return key === undefined
				? node
				: { ...node, group: { definitionRef: key, locked: false } };
		}),
	};
}

/** The root group's document as a project's: its output is the frame. */
function rootDocument({ nodes, edges }: GraphDocument): GraphDocument {
	const output = nodes.find((n) => n.type === "group-output");
	return {
		nodes: nodes.map((n) => (n === output ? { ...n, type: "frag-output" } : n)),
		edges: edges.map((e) => (e.target === output?.id ? { ...e, targetHandle: "color" } : e)),
	};
}

function sceneProject(): GraphProject {
	const groups = buildGroups([root]);
	const own = groups.filter((g) => g.spec.id.startsWith("scene-"));
	const library = new Set(standardLibrary.map((e) => e.ref));
	for (const group of groups) {
		if (!own.includes(group) && !library.has(group.ref)) {
			throw new Error(`${group.ref} isn't the library's: run stdlib:build first`);
		}
	}
	const keys = new Map(own.map((g) => [g.ref, g.spec.id]));
	const definitions: GraphProject["definitions"] = {};
	for (const group of own) {
		const document = documentOf(group, keys);
		if (group.spec === root) definitions[ROOT_ID] = rootDocument(document);
		else definitions[group.spec.id] = document;
	}
	return { definitions };
}

const { values } = parseArgs({
	options: {
		browser: { type: "string" },
		editor: { type: "string", default: EDITOR_URL },
		dry: { type: "boolean", default: false },
	},
});

const project = v.parse(GraphProjectSchema, structuredClone(sceneProject()));
const model = new GraphModel(project);
const plan = generateRenderPlan(model);
const errors = validatePlan(plan);
if (errors.length > 0) {
	console.error(errors.join("\n\n"));
	process.exit(1);
}
for (const [key, document] of Object.entries(project.definitions)) {
	console.log(`${key}: ${String(document.nodes.length)} nodes`);
}

if (!values.dry) {
	const laidOut = await layoutInBrowser(project, values);
	const definitions: GraphProject["definitions"] = {};
	for (const [key, document] of Object.entries(project.definitions)) {
		const placed = new Map(laidOut.definitions[key]?.nodes.map((n) => [n.id, n.position]));
		definitions[key] = {
			...document,
			nodes: document.nodes.map((n) => {
				const { x, y } = placed.get(n.id) ?? n.position;
				return { ...n, position: { x: Math.round(x), y: Math.round(y) } };
			}),
		};
	}
	const path = join(coreDir, "src/scenes/default.json");
	writeFileSync(path, `${JSON.stringify({ definitions }, null, "\t")}\n`);
	spawnSync("bun", ["fmt", path], { cwd: coreDir, stdio: "inherit" });
}
process.exit(0);
