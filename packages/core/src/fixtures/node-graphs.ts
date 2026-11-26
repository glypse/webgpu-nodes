import * as v from "valibot";

import type { GraphProject, StandardLibraryEntry } from "../graph/document";
import { GraphModel } from "../graph/model";
import { GraphProjectSchema } from "../graph/schema";
import type { ColorSpace } from "../graph/settings";
import { NODE_TYPES, type NodeType } from "../nodes/registry";
import {
	libraryEntry,
	libraryHandle,
	rootProject,
	type TestEdge,
	type TestNode,
} from "../testing/graph";
import {
	isTexture,
	type NodeData,
	type SocketType,
	typeComponents,
	typeKind,
	type WgslType,
} from "../types";
import {
	type ExactNumber,
	exactNumber,
	type Feed,
	type GpuFixture,
	type NodeTable,
	toExactNumber,
	type Tolerance,
} from "./format";

/** A case or sweep of a table as a project, the node under test being "subject". */
export type NodeFixture = {
	name: string;
	project: GraphProject;
	/** For cases: what `evaluate(model, "subject", output, colorSpace)` must give. */
	expect?: {
		output: string;
		values: ExactNumber[];
		tolerance?: Tolerance;
		colorSpace: ColorSpace;
	};
	/** What a GPU runner draws and checks. */
	gpu: GpuFixture;
};

const SUBJECT = "subject";
const CHANNELS = ["x", "y", "z", "w"] as const;
const FULL_CANVAS = { width: 16, height: 16 };
const ONE_PIXEL = { width: 1, height: 1 };

type Ref = [node: string, handle: string];
type Wire = (graph: Graph, type: WgslType, target: Ref) => void;
type Setup = {
	types?: Record<string, SocketType>;
	settings?: Record<string, string>;
	values?: Record<string, number | boolean>;
	data?: Record<string, unknown>;
	colorSpace?: ColorSpace;
};

/** Nodes and links built up around the subject, with ids that never repeat. */
class Graph {
	readonly nodes: TestNode[] = [];
	readonly edges: TestEdge[] = [];
	private next = 0;

	node(node: Omit<TestNode, "id">): string {
		const id = `n${String(this.next++)}`;
		this.nodes.push({ id, ...node });
		return id;
	}

	link(source: Ref, target: Ref): void {
		this.edges.push([source[0], source[1], target[0], target[1]]);
	}
}

/** A Declare of `type` holding `values` (the components in order). */
function declare(graph: Graph, type: WgslType, values: readonly number[]): string {
	if (values.length !== typeComponents(type)) {
		throw new Error(`${String(values.length)} values for a ${type}`);
	}
	return graph.node({
		type: "declare",
		data: {
			types: { declare: type },
			values: Object.fromEntries(values.map((v, i) => [CHANNELS[i] ?? "x", v])),
		},
	});
}

/**
 * A value per component: `from + (to - from) * t`, with `t` the UV's x, y, 1 - x
 * and 1 - y for components x, y, z and w, converted to the component's type.
 */
function sweepDeclare(graph: Graph, type: WgslType, from: number, to: number): string {
	const uv = graph.node({ type: "uv", data: {} });
	const split = graph.node({ type: "separate-vector", data: {} });
	graph.link([uv, "uv"], [split, "v"]);
	const fromDeclare = declare(graph, "f32", [from]);
	const toDeclare = declare(graph, "f32", [to]);
	const span = graph.node({ type: "sub", data: {} });
	graph.link([toDeclare, "value"], [span, "a"]);
	graph.link([fromDeclare, "value"], [span, "b"]);

	const components: Ref[] = [];
	for (let k = 0; k < typeComponents(type); k++) {
		let t: Ref;
		if (k < 2) {
			t = [split, CHANNELS[k] ?? "x"];
		} else {
			const one = declare(graph, "f32", [1]);
			const flip = graph.node({ type: "sub", data: {} });
			graph.link([one, "value"], [flip, "a"]);
			graph.link([split, k === 2 ? "x" : "y"], [flip, "b"]);
			t = [flip, "result"];
		}
		const scaled = graph.node({ type: "mul", data: {} });
		graph.link([span, "result"], [scaled, "operands"]);
		graph.link(t, [scaled, "operands"]);
		const value = graph.node({ type: "add", data: {} });
		graph.link([scaled, "result"], [value, "operands"]);
		graph.link([fromDeclare, "value"], [value, "operands"]);

		const kind = typeKind(type);
		if (kind === "f32") {
			components.push([value, "result"]);
		} else {
			const convert = graph.node({
				type: kind === "i32" ? "to-int" : kind === "u32" ? "to-uint" : "to-bool",
				data: {},
			});
			graph.link([value, "result"], [convert, "e"]);
			components.push([convert, "result"]);
		}
	}

	const composed = graph.node({
		type: "declare",
		data: { types: { declare: type }, values: {} },
	});
	components.forEach((c, k) => {
		graph.link(c, [composed, CHANNELS[k] ?? "x"]);
	});
	return composed;
}

/** Wires for each value of a case input: a Declare of the input's type per value. */
function constantWire(values: readonly ExactNumber[]): Wire {
	return (graph, type, target) => {
		graph.link([declare(graph, type, values.map(exactNumber)), "value"], target);
	};
}

function sweepWire(from: number, to: number): Wire {
	return (graph, type, target) => {
		graph.link([sweepDeclare(graph, type, from, to), "value"], target);
	};
}

/** One link per feed, so a list of feeds fills an input that takes several operands. */
function feedsWire(feeds: readonly Feed[]): Wire {
	const wires = feeds.map((feed) =>
		feed.kind === "uv" ? sweepWire(feed.from, feed.to) : constantWire(feed.value),
	);
	return (graph, type, target) => {
		for (const wire of wires) wire(graph, type, target);
	};
}

/** The type variable of the socket labelled `label` on a group: the key its setup's `types` use. */
function typeVariableOf(group: StandardLibraryEntry, label: string): string {
	const sockets = [...(group.definition.inputs ?? []), ...(group.definition.outputs ?? [])];
	const type = sockets.find((socket) => socket.label === label)?.type;
	if (typeof type === "object") return type.variable;
	throw new Error(`"${label}" has no type variable in "${group.id}"`);
}

/**
 * The node data of the subject. A group's setup is keyed by socket label, its
 * `types` by the label of a socket of each type variable, so these become ids.
 */
function subjectData(setup: Setup, group: StandardLibraryEntry | undefined): NodeData {
	if (!group) {
		return {
			...setup.data,
			types: setup.types,
			settings: setup.settings,
			values: setup.values,
		};
	}
	const values =
		setup.values &&
		Object.fromEntries(
			Object.entries(setup.values).map(([label, value]) => [
				libraryHandle(group, "group-input", label),
				value,
			]),
		);
	const types =
		setup.types &&
		Object.fromEntries(
			Object.entries(setup.types).map(([label, type]) => [
				typeVariableOf(group, label),
				type,
			]),
		);
	return { ...setup.data, types, settings: setup.settings, values };
}

/**
 * Reads the output into the canvas: integers and booleans go through To Float,
 * and the components land in R, G, B, A with w = 1 when the output has fewer.
 */
function readout(graph: Graph, type: WgslType, source: Ref): void {
	let float: Ref = source;
	if (typeKind(type) !== "f32") {
		const convert = graph.node({ type: "to-float", data: {} });
		graph.link(source, [convert, "e"]);
		float = [convert, "result"];
	}
	const count = typeComponents(type);
	let components: Ref[] = [float];
	if (count > 1) {
		const split = graph.node({ type: "separate-vector", data: {} });
		graph.link(float, [split, "v"]);
		components = CHANNELS.slice(0, count).map((c): Ref => [split, c]);
	}
	const color = graph.node({
		type: "declare",
		data: { types: { declare: "vec4f" }, values: { x: 0, y: 0, z: 0, w: 1 } },
	});
	components.forEach((c, k) => {
		graph.link(c, [color, CHANNELS[k] ?? "x"]);
	});
	graph.link([color, "value"], ["out", "color"]);
}

function nodeType(name: string): NodeType {
	const found = NODE_TYPES.find((t) => t === name);
	if (!found) throw new Error(`no node type "${name}"`);
	return found;
}

/** A group's socket by label, or the node type's handle as it is. */
function handleOf(
	group: StandardLibraryEntry | undefined,
	side: "group-input" | "group-output",
	key: string,
): string {
	return group ? libraryHandle(group, side, key) : key;
}

function notTexture(type: SocketType, what: string): WgslType {
	if (isTexture(type)) throw new Error(`${what} is a texture`);
	return type;
}

/**
 * Builds the project for one case or sweep. The subject is first built alone
 * to read each fed input's and the output's resolved type; the project built
 * with the wires must then resolve to the same types.
 */
function assemble(
	table: NodeTable,
	setup: Setup,
	wires: Record<string, Wire>,
	output: string,
	group: StandardLibraryEntry | undefined,
): { project: GraphProject; output: string; outputType: WgslType } {
	const data = subjectData(setup, group);
	const subject: TestNode = group
		? {
				id: SUBJECT,
				type: "node-group",
				data,
				group: { definitionRef: group.ref, locked: true },
			}
		: { id: SUBJECT, type: nodeType(table.node), data };

	const probe = new GraphModel(rootProject([subject], []));
	const inputs = Object.entries(wires).map(([key, wire]) => {
		const handle = handleOf(group, "group-input", key);
		const type = notTexture(probe.resolveInputType(SUBJECT, handle), `${key} input`);
		return { handle, type, wire };
	});
	const outHandle = handleOf(group, "group-output", output);
	const outputType = notTexture(
		probe.resolveOutputHandleType(SUBJECT, outHandle),
		`${output} output`,
	);

	const graph = new Graph();
	for (const { handle, type, wire } of inputs) wire(graph, type, [SUBJECT, handle]);
	readout(graph, outputType, [SUBJECT, outHandle]);
	const project = rootProject([subject, ...graph.nodes], graph.edges);
	// Throws when the table's node data, merged in unchecked, isn't valid graph data.
	v.parse(GraphProjectSchema, project);

	const built = new GraphModel(project);
	for (const { handle, type } of inputs) {
		const resolved = built.resolveInputType(SUBJECT, handle);
		if (resolved !== type) throw new Error(`"${handle}" resolves to ${resolved}, not ${type}`);
	}
	if (built.resolveOutputHandleType(SUBJECT, outHandle) !== outputType) {
		throw new Error(`"${outHandle}" resolves to another type once fed`);
	}
	return { project, output: outHandle, outputType };
}

type Rgba = [ExactNumber | null, ExactNumber | null, ExactNumber | null, ExactNumber | null];

/** The pixel a case must draw: its values rounded to f32, the padding null and w = 1. */
function casePixel(values: readonly ExactNumber[], count: number): Rgba {
	const component = (k: number): ExactNumber | null => {
		if (k < count) return toExactNumber(Math.fround(exactNumber(values[k] ?? 0)));
		return k === 3 ? 1 : null;
	};
	return [component(0), component(1), component(2), component(3)];
}

function pixelsFixture(
	description: string,
	size: { width: number; height: number },
	colorSpace: ColorSpace,
	checks: GpuFixture["checks"],
): GpuFixture {
	return {
		description,
		size,
		format: "rgba32float",
		colorSpace,
		frames: [{ time: 0, delta: 1 / 60, frame: 0 }],
		checks,
		timed: false,
	};
}

/** A case or sweep of `table`, as fixtures: one per case, then one per sweep. */
export function nodeFixtures(table: NodeTable): NodeFixture[] {
	const group = table.node.startsWith("std-") ? libraryEntry(table.node) : undefined;
	const fixtures: NodeFixture[] = [];
	const names = new Set<string>();
	const add = (fixture: NodeFixture) => {
		if (names.has(fixture.name)) throw new Error(`duplicate fixture "${fixture.name}"`);
		names.add(fixture.name);
		fixtures.push(fixture);
	};

	table.cases.forEach((c, i) => {
		const name = `${table.node}: ${c.note ?? String(i)}`;
		const wires = Object.fromEntries(
			Object.entries(c.inputs).map(([key, values]) => [
				key,
				(graph: Graph, type: WgslType, target: Ref) => {
					for (const value of values) constantWire(value)(graph, type, target);
				},
			]),
		);
		const built = assemble(table, c, wires, c.output, group);
		const count = typeComponents(built.outputType);
		if (c.expect.length !== count) {
			throw new Error(`${name}: ${String(c.expect.length)} values for a ${built.outputType}`);
		}
		const colorSpace = c.colorSpace ?? "srgb";
		const tolerance = c.tolerance ?? { abs: 0, rel: 0 };
		add({
			name,
			project: built.project,
			expect: { output: built.output, values: c.expect, tolerance: c.tolerance, colorSpace },
			gpu: pixelsFixture(name, ONE_PIXEL, colorSpace, [
				{
					kind: "pixels",
					tolerance,
					pixels: [{ x: 0, y: 0, rgba: casePixel(c.expect, count) }],
				},
			]),
		});
	});

	table.sweeps.forEach((s, i) => {
		const name = `${table.node}: ${s.note ?? String(i)}`;
		const wires = Object.fromEntries(
			Object.entries(s.inputs).map(([key, feeds]) => [
				key,
				feedsWire(Array.isArray(feeds) ? feeds : [feeds]),
			]),
		);
		const built = assemble(table, s, wires, s.output, group);
		const count = typeComponents(built.outputType);
		add({
			name,
			project: built.project,
			gpu: pixelsFixture(name, FULL_CANVAS, s.colorSpace ?? "srgb", [
				{
					kind: "cpu",
					channels: Array.from({ length: count }, (_, k) => k),
					stride: s.stride,
					tolerance: s.tolerance,
					maxOff: s.maxOff,
				},
			]),
		});
	});

	return fixtures;
}
