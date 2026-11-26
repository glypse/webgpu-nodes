// Performance baselines: the demo scene and a large synthetic project, timed
// on the CPU side the Rust port would replace. The GPU frame time is measured
// in the browser (see docs/plans/perf-baselines.md).
//
//   bun run perf                 measure and print the tables
//   bun run perf --write         also write them into docs/plans/perf-baselines.md
//   bun run perf --write-large   regenerate fixtures/perf/large.json first

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import * as v from "valibot";

import {
	editableScopes,
	generateRenderPlan,
	planKey,
	planUniformInputs,
	planUniforms,
	reachableShaderHash,
	type RenderPlan,
} from "../src/codegen";
import {
	type GraphDocument,
	type GraphDocumentEdge,
	type GraphDocumentNode,
	type GraphProject,
	ROOT_ID,
} from "../src/graph/document";
import { GraphModel } from "../src/graph/model";
import { GraphProjectSchema } from "../src/graph/schema";
import { standardLibrary } from "../src/library";
import type { NodeType } from "../src/nodes/registry";
import { defaultScene } from "../src/scenes";
import type { GroupHandleDef, NodeData } from "../src/types";

const ROOT = join(import.meta.dirname, "../../..");
const DEMO_PATH = join(ROOT, "fixtures/perf/demo.json");
const LARGE_PATH = join(ROOT, "fixtures/perf/large.json");
const GPU_LARGE_PATH = join(ROOT, "fixtures/gpu/perf-large/project.json");
const PLAN_PATH = join(ROOT, "docs/plans/perf-baselines.md");

const RUNS = 30;
const WARMUP = 3;
const START_MARKER = "<!-- perf:start -->";
const END_MARKER = "<!-- perf:end -->";

const USER_GROUPS = 20;
const GLOW = "scene-glow";
const COLUMNS = 40;

// ── The large project ────────────────────────────────────────────────────────

/** A node's output or input: the node and the handle on it. */
type Port = { node: string; handle: string };

/** Builds one document; ids are counted, so the same calls give the same project. */
class DocBuilder {
	readonly nodes: GraphDocumentNode[] = [];
	readonly edges: GraphDocumentEdge[] = [];
	private counter = 0;

	constructor(private readonly prefix: string) {}

	id(): string {
		return `${this.prefix}-${String(this.counter++)}`;
	}

	node(type: NodeType, data: NodeData = {}, group?: GraphDocumentNode["group"]): string {
		const id = this.id();
		const index = this.nodes.length;
		this.nodes.push({
			id,
			type,
			data,
			position: { x: (index % COLUMNS) * 240, y: Math.floor(index / COLUMNS) * 140 },
			...(group ? { group } : {}),
		});
		return id;
	}

	link(source: Port, target: Port) {
		this.edges.push({
			id: this.id(),
			source: source.node,
			sourceHandle: source.handle,
			target: target.node,
			targetHandle: target.handle,
		});
	}
}

function constant(d: DocBuilder, [x, y, z, w]: readonly [number, number, number, number]): Port {
	const node = d.node("declare", { types: { declare: "vec4f" }, values: { x, y, z, w } });
	return { node, handle: "value" };
}

function combine(d: DocBuilder, type: "add" | "mul", inputs: readonly Port[]): Port {
	const node = d.node(type);
	for (const input of inputs) d.link(input, { node, handle: "operands" });
	return { node, handle: "result" };
}

function sine(d: DocBuilder, input: Port): Port {
	const node = d.node("sin");
	d.link(input, { node, handle: "e" });
	return { node, handle: "result" };
}

/** Steps of add, sin and mul in turn, each with a constant, so the values stay bounded. */
function chain(d: DocBuilder, start: Port, steps: number, salt: number): Port {
	let current = start;
	for (let i = 0; i < steps; i++) {
		const n = i + salt;
		if (n % 3 === 0) {
			current = combine(d, "add", [current, constant(d, [0.01 * (n % 7), 0.02, 0.03, 0])]);
		} else if (n % 3 === 1) {
			current = sine(d, current);
		} else {
			current = combine(d, "mul", [current, constant(d, [0.9 + 0.01 * (n % 21), 1, 1, 1])]);
		}
	}
	return current;
}

const groupRef = (k: number) => `user-group-${String(k)}`;

/** Groups 5 to 14 hold the group 5 places below them: a chain of two nested groups. */
function nestedIn(k: number): number | undefined {
	return k >= 5 && k <= 14 ? k - 5 : undefined;
}

function instance(d: DocBuilder, k: number, input: Port): Port {
	const node = d.node("node-group", {}, { definitionRef: groupRef(k), locked: false });
	d.link(input, { node, handle: `group${String(k)}-in` });
	return { node, handle: `group${String(k)}-out` };
}

function userGroup(k: number): GraphDocument {
	const d = new DocBuilder(`group${String(k)}`);
	const inputId = `group${String(k)}-in`;
	const outputId = `group${String(k)}-out`;
	let current: Port = { node: d.node("group-input"), handle: inputId };
	current = chain(d, current, 22, k);
	const child = nestedIn(k);
	if (child !== undefined) current = instance(d, child, current);
	current = chain(d, current, 22, k + 1);
	d.link(current, { node: d.node("group-output"), handle: outputId });
	return {
		label: `Group ${String(k)}`,
		inputs: [{ id: inputId, label: "In", type: "vec4f" }],
		outputs: [{ id: outputId, label: "Out", type: "vec4f" }],
		nodes: d.nodes,
		edges: d.edges,
	};
}

function renderTexture(d: DocBuilder, color: Port): Port {
	const item = d.id();
	const node = d.node("render-texture", {
		values: { scale: 0.5 },
		settings: { mode: "scale", mips: "off" },
		items: [{ id: item, label: "Color", type: "vec4f", format: "rgba16float" }],
	});
	d.link(color, { node, handle: item });
	return { node, handle: item };
}

/** A repeat zone whose state item starts at `initial` and is stepped four times. */
function repeatZone(d: DocBuilder, initial: Port): Port {
	const item = d.id();
	const output = d.node("repeat-output", {
		items: [{ id: item, label: "Value", type: { inferred: true } }],
	});
	const input = d.node("repeat-input", {
		pairedOutput: output,
		values: { iterations: 4 },
		maxIterations: 1024,
	});
	d.link(initial, { node: input, handle: item });
	const stepped = combine(d, "mul", [
		sine(d, { node: input, handle: item }),
		constant(d, [0.5, 0.5, 0.5, 0.5]),
	]);
	d.link(stepped, { node: output, handle: item });
	return { node: output, handle: item };
}

/** The handle of `label` among a definition's handles: a port of an instance is named by its handle id. */
function port(handles: readonly GroupHandleDef[] | undefined, node: string, label: string): Port {
	const handle = handles?.find((h) => h.label === label);
	if (!handle) throw new Error(`no handle "${label}"`);
	return { node, handle: handle.id };
}

function libraryEntry(id: string) {
	const entry = standardLibrary.find((e) => e.id === id);
	if (!entry) throw new Error(`no standard-library entry "${id}"`);
	return entry;
}

function libraryInstance(d: DocBuilder, id: string) {
	const entry = libraryEntry(id);
	const node = d.node("node-group", {}, { definitionRef: entry.ref, locked: true });
	return {
		input: (label: string) => port(entry.definition.inputs, node, label),
		output: (label: string) => port(entry.definition.outputs, node, label),
	};
}

function rootDocument(): GraphDocument {
	const d = new DocBuilder("root");
	let longChain = constant(d, [0.1, 0.2, 0.3, 0.4]);
	let midpoint = longChain;
	for (let s = 0; s < 10; s++) {
		longChain = chain(d, longChain, 20, s);
		if (s === 4) midpoint = longChain;
	}
	const leaves: Port[] = [longChain];
	for (let s = 0; s < 40; s++) {
		const start = constant(d, [0.01 * s, 0.2, 0.3, 0.4]);
		leaves.push(instance(d, (s + 10) % USER_GROUPS, chain(d, start, 15, s)));
	}
	const chainB: Port[] = [];
	for (let s = 0; s < 20; s++) {
		chainB.push(chain(d, constant(d, [0.4, 0.3, 0.2, 0.1]), 10, 100 + s));
	}
	leaves.push(...chainB);

	for (let z = 0; z < 10; z++) {
		leaves.push(repeatZone(d, constant(d, [0.1 * z, 0.2, 0.3, 0.4])));
	}

	const uv: Port = { node: d.node("uv"), handle: "uv" };
	const sampled = d.node("sample-texture", {
		values: { interpolation: 0, extension: 0, level: 0 },
	});
	d.link(renderTexture(d, chainB[0] ?? midpoint), { node: sampled, handle: "texture" });
	d.link(uv, { node: sampled, handle: "uv" });
	leaves.push({ node: sampled, handle: "color" });

	const cubic = libraryInstance(d, "std-sample-cubic");
	d.link(renderTexture(d, midpoint), cubic.input("Texture"));
	d.link(uv, cubic.input("UV"));
	leaves.push(cubic.output("Color"));

	const glowDoc = defaultScene.definitions[GLOW];
	if (!glowDoc) throw new Error(`the demo has no "${GLOW}"`);
	const glow = d.node("node-group", {}, { definitionRef: GLOW, locked: false });
	d.link(renderTexture(d, longChain), port(glowDoc.inputs, glow, "Texture"));
	leaves.push(port(glowDoc.outputs, glow, "Color"));

	const legend = libraryInstance(d, "std-flow-legend");
	leaves.push(legend.output("Color"));

	const hash = libraryInstance(d, "std-hash");
	d.link(chainB[1] ?? midpoint, hash.input("Value"));
	leaves.push(hash.output("Hash"));

	let level = leaves;
	while (level.length > 1) {
		const next: Port[] = [];
		for (let i = 0; i < level.length; i += 4) {
			const group = level.slice(i, i + 4);
			const [only] = group;
			next.push(group.length === 1 && only ? only : combine(d, "add", group));
		}
		level = next;
	}
	const [top] = level;
	if (!top) throw new Error("no output to draw");
	d.link(top, { node: d.node("frag-output"), handle: "color" });

	return { nodes: d.nodes, edges: d.edges };
}

/** A project of about 2000 math and vector nodes, user groups, repeat zones, render textures and library groups. */
export function buildLargeProject(): GraphProject {
	const definitions: Record<string, GraphDocument> = { [ROOT_ID]: rootDocument() };
	for (let k = 0; k < USER_GROUPS; k++) definitions[groupRef(k)] = userGroup(k);
	definitions[GLOW] = structuredClone(glowOrThrow());
	return { definitions };
}

function glowOrThrow(): GraphDocument {
	const glow = defaultScene.definitions[GLOW];
	if (!glow) throw new Error(`the demo has no "${GLOW}"`);
	return glow;
}

// ── Measuring ────────────────────────────────────────────────────────────────

const clone = <T>(value: T): T => structuredClone(value);

function loadProject(path: string): GraphProject {
	return v.parse(GraphProjectSchema, JSON.parse(readFileSync(path, "utf8")));
}

const noop = () => undefined;

/** Runs `body` `RUNS` times after `WARMUP` runs, `reset` untimed after each. */
function time(body: () => unknown, reset: () => void = noop): number[] {
	const samples: number[] = [];
	for (let i = 0; i < WARMUP + RUNS; i++) {
		const start = performance.now();
		body();
		const elapsed = performance.now() - start;
		if (i >= WARMUP) samples.push(elapsed);
		reset();
	}
	return samples;
}

type Stats = { median: number; p95: number };

function stats(samples: readonly number[]): Stats {
	const sorted = [...samples].sort((a, b) => a - b);
	const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
	return { median: at(0.5) ?? 0, p95: at(0.95) ?? 0 };
}

/**
 * What the editor does after a graph edit (see `Editor.svelte` and
 * `graph-view.svelte.ts`): the active document's zone and frame analyses and
 * unavailable links, then the shader, regenerated only when its hash, with
 * the uniform inputs ignored, has changed.
 */
type Editor = {
	prevHash: string;
	shown: { plan: RenderPlan; inputs: ReadonlySet<string>; hash: string } | undefined;
};

const newEditor = (): Editor => ({ prevHash: "", shown: undefined });

function editorRecompute(model: GraphModel, editor: Editor) {
	const doc = model.activeDocument;
	model.zoneAnalysis(doc);
	model.frameAnalysis(doc);
	model.unavailableLinks(doc);

	const scopes = editableScopes(model.project);
	const prefix = scopes.join(",");
	const hash = `${prefix}|${reachableShaderHash(model.project, model.assets)}`;
	if (hash === editor.prevHash) return;
	editor.prevHash = hash;
	const hashWithout = (inputs: ReadonlySet<string>) =>
		`${prefix}|${reachableShaderHash(model.project, model.assets, inputs)}`;
	const known = editor.shown;
	const unchanged = known ? known.hash === hashWithout(known.inputs) : false;
	if (known && unchanged) {
		planUniforms(known.plan, model);
		return;
	}
	const plan = generateRenderPlan(model, { uniformScopes: scopes });
	const inputs = planUniformInputs(plan);
	planKey(plan);
	editor.shown = { plan, inputs, hash: hashWithout(inputs) };
}

type Heights = Map<string, number>;

/** The longest path from each node of `doc` to a node with no links out: how far upstream it sits. */
function heights(doc: GraphDocument): Heights {
	const outgoing = new Map<string, string[]>();
	for (const e of doc.edges)
		outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
	const memo: Heights = new Map();
	const visit = (id: string): number => {
		const known = memo.get(id);
		if (known !== undefined) return known;
		let best = 0;
		for (const next of outgoing.get(id) ?? []) best = Math.max(best, 1 + visit(next));
		memo.set(id, best);
		return best;
	};
	for (const n of doc.nodes) visit(n.id);
	return memo;
}

function rootOf(project: GraphProject): GraphDocument {
	const root = project.definitions[ROOT_ID];
	if (!root) throw new Error("no root document");
	return root;
}

/** The constant upstream of the most nodes: a change to it reaches the most of the graph. */
function deepestConstant(doc: GraphDocument): string {
	const height = heights(doc);
	const declares = doc.nodes.filter((n) => n.type === "declare");
	const [first] = declares;
	if (!first) throw new Error("no constant to edit");
	return declares.reduce(
		(best, n) => ((height.get(n.id) ?? 0) > (height.get(best.id) ?? 0) ? n : best),
		first,
	).id;
}

const OUTPUT_HANDLE: Partial<Record<NodeType, string>> = {
	declare: "value",
	add: "result",
	mul: "result",
	sin: "result",
	uv: "uv",
};

type Connection = { source: string; sourceHandle: string; target: string; targetHandle: string };

/** A valid new link from a node far upstream into the operands of one nearer the output. */
function findConnection(model: GraphModel, doc: GraphDocument): Connection {
	const height = heights(doc);
	const sources = doc.nodes
		.filter((n) => OUTPUT_HANDLE[n.type] !== undefined)
		.sort((a, b) => (height.get(b.id) ?? 0) - (height.get(a.id) ?? 0))
		.slice(0, 200);
	const targets = doc.nodes
		.filter((n) => n.type === "add" || n.type === "mul")
		.sort((a, b) => (height.get(a.id) ?? 0) - (height.get(b.id) ?? 0))
		.slice(0, 200);
	for (const source of sources) {
		for (const target of targets) {
			const connection = {
				source: source.id,
				sourceHandle: OUTPUT_HANDLE[source.type] ?? "",
				target: target.id,
				targetHandle: "operands",
			};
			if (source.id !== target.id && model.isValidConnection(connection)) return connection;
		}
	}
	throw new Error("no valid connection to try");
}

type Bench = { name: string; run: (project: GraphProject) => number[] };

const BENCHES: Bench[] = [
	{
		name: "Load (`new GraphModel`)",
		run: (project) => {
			let copy = clone(project);
			return time(
				() => new GraphModel(copy),
				() => {
					copy = clone(project);
				},
			);
		},
	},
	{
		name: "Codegen (`generateRenderPlan`, warm model)",
		run: (project) => {
			const model = new GraphModel(clone(project));
			const uniformScopes = editableScopes(model.project);
			return time(() => generateRenderPlan(model, { uniformScopes }));
		},
	},
	{
		name: "Shader hash (`reachableShaderHash`, warm model)",
		run: (project) => {
			const model = new GraphModel(clone(project));
			return time(() => reachableShaderHash(model.project, model.assets));
		},
	},
	{
		name: "Value edit: `setInputValue` + editor recompute",
		run: (project) => {
			const model = new GraphModel(clone(project));
			const editor = newEditor();
			editorRecompute(model, editor);
			const target = deepestConstant(rootOf(project));
			let tick = 0;
			return time(() => {
				tick++;
				model.apply({
					kind: "setInputValue",
					args: [target, "x", tick % 2 === 0 ? 0.25 : 0.75],
				});
				editorRecompute(model, editor);
			});
		},
	},
	{
		name: "Connect: `connect` + editor recompute",
		run: (project) => {
			const model = new GraphModel(clone(project));
			const editor = newEditor();
			editorRecompute(model, editor);
			const connection = findConnection(model, rootOf(project));
			return time(
				() => {
					model.apply({ kind: "connect", args: [connection] });
					editorRecompute(model, editor);
				},
				() => {
					model.undo();
					editorRecompute(model, editor);
				},
			);
		},
	},
	{
		name: "Move 10 nodes: `moveNodes` + editor recompute",
		run: (project) => {
			const model = new GraphModel(clone(project));
			const editor = newEditor();
			editorRecompute(model, editor);
			const moved = rootOf(project)
				.nodes.filter((n) => n.type === "add" || n.type === "mul" || n.type === "sin")
				.slice(0, 10);
			const from = Object.fromEntries(moved.map((n) => [n.id, n.position]));
			let tick = 0;
			return time(() => {
				tick++;
				model.apply({
					kind: "moveNodes",
					args: [from, { x: tick % 2 === 0 ? -10 : 10, y: 0 }],
				});
				editorRecompute(model, editor);
			});
		},
	},
	{
		name: "Cold: `rebuildTypeCache`",
		run: (project) => {
			let model = new GraphModel(clone(project));
			return time(
				() => {
					model.rebuildTypeCache();
				},
				() => {
					model = new GraphModel(clone(project));
				},
			);
		},
	},
	{
		name: "Cold: `zoneAnalysis`",
		run: (project) => {
			let model = new GraphModel(clone(project));
			return time(
				() => model.zoneAnalysis(model.activeDocument),
				() => {
					model = new GraphModel(clone(project));
				},
			);
		},
	},
	{
		name: "Cold: `frameAnalysis`",
		run: (project) => {
			let model = new GraphModel(clone(project));
			return time(
				() => model.frameAnalysis(model.activeDocument),
				() => {
					model = new GraphModel(clone(project));
				},
			);
		},
	},
	{
		name: "Cold: `unavailableLinks`",
		run: (project) => {
			let model = new GraphModel(clone(project));
			return time(
				() => model.unavailableLinks(model.activeDocument),
				() => {
					model = new GraphModel(clone(project));
				},
			);
		},
	},
	{
		name: "Cold: `passAnalysis` (`renders()`, every texture)",
		run: (project) => {
			let model = new GraphModel(clone(project));
			return time(
				() => model.passAnalysis().renders(),
				() => {
					model = new GraphModel(clone(project));
				},
			);
		},
	},
	{
		name: "Cold: `frameValueAnalysis` (every root link, passes warm)",
		run: (project) => {
			let model = new GraphModel(clone(project));
			model.passAnalysis().renders();
			return time(
				() => {
					const analysis = model.frameValueAnalysis();
					for (const edge of model.activeDocument.edges) analysis.link([], edge);
				},
				() => {
					model = new GraphModel(clone(project));
					model.passAnalysis().renders();
				},
			);
		},
	},
];

// ── Output ───────────────────────────────────────────────────────────────────

function size(project: GraphProject): string {
	const documents = Object.values(project.definitions);
	const nodes = documents.reduce((sum, d) => sum + d.nodes.length, 0);
	const edges = documents.reduce((sum, d) => sum + d.edges.length, 0);
	const root = rootOf(project);
	return `${String(nodes)} nodes and ${String(edges)} links in ${String(documents.length)} documents (${String(root.nodes.length)} nodes in the root)`;
}

function markdown(
	demo: GraphProject,
	large: GraphProject,
	rows: { name: string; demo: Stats; large: Stats }[],
): string {
	const fmt = (x: number) => x.toFixed(2);
	const lines = [
		`Demo: ${size(demo)}. Large: ${size(large)}.`,
		"",
		`Times in ms, from ${String(RUNS)} runs after ${String(WARMUP)} warm-up runs, on Bun ${Bun.version} (${process.platform} ${process.arch}).`,
		"",
		"| Measurement | Demo median | Demo p95 | Large median | Large p95 |",
		"| --- | ---: | ---: | ---: | ---: |",
		...rows.map(
			(r) =>
				`| ${r.name} | ${fmt(r.demo.median)} | ${fmt(r.demo.p95)} | ${fmt(r.large.median)} | ${fmt(r.large.p95)} |`,
		),
	];
	return lines.join("\n");
}

function writeBlock(text: string) {
	const doc = readFileSync(PLAN_PATH, "utf8");
	const start = doc.indexOf(START_MARKER);
	const end = doc.indexOf(END_MARKER);
	if (start < 0 || end < start)
		throw new Error(`${PLAN_PATH} needs the ${START_MARKER} and ${END_MARKER} markers`);
	const before = doc.slice(0, start + START_MARKER.length);
	writeFileSync(PLAN_PATH, `${before}\n\n${text}\n\n${doc.slice(end)}`);
}

const { values } = parseArgs({
	options: {
		write: { type: "boolean", default: false },
		"write-large": { type: "boolean", default: false },
	},
});

if (values["write-large"]) {
	const project = buildLargeProject();
	const check = new GraphModel(clone(v.parse(GraphProjectSchema, project)));
	generateRenderPlan(check);
	const text = `${JSON.stringify(project, null, 2)}\n`;
	writeFileSync(LARGE_PATH, text);
	writeFileSync(GPU_LARGE_PATH, text);
	console.log(`wrote ${LARGE_PATH} and ${GPU_LARGE_PATH}`);
}

const demo = loadProject(DEMO_PATH);
const large = loadProject(LARGE_PATH);
const rows = BENCHES.map((bench) => {
	console.log(`measuring ${bench.name}`);
	return { name: bench.name, demo: stats(bench.run(demo)), large: stats(bench.run(large)) };
});
const table = markdown(demo, large, rows);
console.log(`\n${table}`);
if (values.write) {
	writeBlock(table);
	console.log(`wrote ${PLAN_PATH}`);
}
