import { clipToGamut } from "../color/display";
import { LINEAR_CURVE, evaluateCurve } from "../curve";
import { MATCH_SELECTOR, caseHandle } from "../enums";
import type { GraphNode, HydratedGraphDocument } from "../graph/document";
import type { GraphModel } from "../graph/model";
import type { ColorSpace } from "../graph/settings";
import { componentKeys, readComponent } from "../graph/values";
import { type ResolvedNodeTypes, type TypeBindings, enumValue, typeComponents } from "../types";
import {
	ITERATIONS_HANDLE,
	ITERATION_HANDLE,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	zoneItems,
	zoneMaxIterations,
} from "../zones";

/** A value as its components. */
export type Value = number[];

type Frame = {
	doc: HydratedGraphDocument;
	/** The gamut of the target drawn to. */
	colorSpace: ColorSpace;
	/** The types the document's variables take (see `TypeBindings`). */
	bindings: TypeBindings;
	groupInputs: ReadonlyMap<string, Value>;
	/** The current state of the repeat zones being run, by Repeat Input id. */
	zones: ReadonlyMap<string, { iteration: number; state: ReadonlyMap<string, Value> }>;
	/** The final state of the zones run in this frame, by Repeat Output id. */
	finals: Map<string, ReadonlyMap<string, Value>>;
	/** Outputs computed in this frame, by node and handle id. */
	computed: Map<string, Value>;
};

const map = (v: Value, f: (n: number) => number) => v.map(f);

/** Component-wise `f`, a single component standing for all of them. */
function zip(values: Value[], f: (...n: number[]) => number): Value {
	const width = Math.max(...values.map((v) => v.length));
	return Array.from({ length: width }, (_, i) =>
		f(...values.map((v) => v[v.length === 1 ? 0 : i] ?? 0)),
	);
}

function fit(value: Value, width: number): Value {
	if (value.length === 1) return Array.from({ length: width }, () => value[0] ?? 0);
	return Array.from({ length: width }, (_, i) => value[i] ?? 0);
}

const UNARY: Record<string, (n: number) => number> = {
	abs: Math.abs,
	sign: Math.sign,
	sin: Math.sin,
	cos: Math.cos,
	fract: (n) => n - Math.floor(n),
	floor: Math.floor,
	sqrt: Math.sqrt,
};

const VARIADIC: Record<string, (a: number, b: number) => number> = {
	add: (a, b) => a + b,
	mul: (a, b) => a * b,
	max: Math.max,
	min: Math.min,
};

const BINARY: Record<string, [string, string, (a: number, b: number) => number]> = {
	sub: ["a", "b", (a, b) => a - b],
	div: ["a", "b", (a, b) => (b === 0 ? 0 : a / b)],
	pow: ["e1", "e2", (a, b) => (b === 0 ? 1 : a ** b)],
	atan2: ["e1", "e2", Math.atan2],
};

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
	"<": (a, b) => a < b,
	"<=": (a, b) => a <= b,
	"==": (a, b) => a === b,
	"!=": (a, b) => a !== b,
	">=": (a, b) => a >= b,
	">": (a, b) => a > b,
};

const BOOLEAN: Record<string, (a: boolean, b: boolean) => boolean> = {
	and: (a, b) => a && b,
	or: (a, b) => a || b,
	xor: (a, b) => a !== b,
	nand: (a, b) => !(a && b),
	nor: (a, b) => !(a || b),
	xnor: (a, b) => a === b,
};

/**
 * Compute an output of a node of the root document on the CPU, for the
 * node types the standard library's maths uses, as drawn to `colorSpace`.
 * Throws on any other node type.
 */
export function evaluate(
	model: GraphModel,
	nodeId: string,
	handleId: string,
	colorSpace: ColorSpace = "srgb",
): Value {
	const frame = {
		doc: model.root,
		colorSpace,
		groupInputs: new Map(),
		zones: new Map(),
		finals: new Map(),
		computed: new Map(),
		bindings: {},
	};
	return output(model, frame, nodeId, handleId);
}

/** A node's types in `frame`. */
function typesIn(model: GraphModel, frame: Frame, node: GraphNode): ResolvedNodeTypes {
	return model.typeResolver.resolveNodeTypes(
		node,
		frame.doc.edgesByTarget.get(node.id) ?? [],
		(id) => model.resolveNode(id),
		frame.bindings,
	);
}

function input(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value {
	const type = typesIn(model, frame, node).inputTypes[inputId] ?? "f32";
	const width = typeComponents(type);
	const edge = frame.doc.edgesByTarget.get(node.id)?.find((e) => e.targetHandle === inputId);
	if (edge) return fit(output(model, frame, edge.source, edge.sourceHandle), width);
	const stored =
		node.data.values?.[inputId] ?? model.resolveDescriptor(node).defaultData.values?.[inputId];
	const keys = componentKeys(type);
	return keys.map((k) => readComponent(stored, k));
}

function inputs(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value[] {
	const edges = frame.doc.edgesByTarget.get(node.id)?.filter((e) => e.targetHandle === inputId);
	return (edges ?? []).map((e) => output(model, frame, e.source, e.sourceHandle));
}

function output(model: GraphModel, frame: Frame, nodeId: string, handleId: string): Value {
	const key = `${nodeId}:${handleId}`;
	const done = frame.computed.get(key);
	if (done) return done;
	const value = compute(model, frame, nodeId, handleId);
	frame.computed.set(key, value);
	return value;
}

function compute(model: GraphModel, frame: Frame, nodeId: string, handleId: string): Value {
	const node = frame.doc.nodesById.get(nodeId);
	if (!node?.type) throw new Error(`no node "${nodeId}"`);
	const type = node.type;
	const get = (id: string) => input(model, frame, node, id);
	const resolved = typesIn(model, frame, node);
	const width = typeComponents(
		resolved.resolvedOutputs.find((o) => o.id === handleId)?.type ?? resolved.outputType,
	);

	if (type === "group-input") {
		const value = frame.groupInputs.get(handleId);
		if (!value) throw new Error(`no value for group input "${handleId}"`);
		return value;
	}
	if (type === "node-group") {
		const doc = node.group && model.project.definitions.get(node.group.definitionRef);
		if (!doc) throw new Error(`no definition for "${nodeId}"`);
		const descriptor = model.resolveDescriptor(node);
		const groupInputs = new Map(descriptor.inputs.map((i) => [i.id, get(i.id)]));
		const inner = {
			doc,
			colorSpace: frame.colorSpace,
			groupInputs,
			zones: new Map(),
			finals: new Map(),
			computed: new Map(),
			bindings: resolved.bindings ?? {},
		};
		const out = doc.nodes.find((n) => n.type === "group-output");
		if (!out) throw new Error("no group output");
		return input(model, inner, out, handleId);
	}
	const unary = UNARY[type];
	if (unary) return map(get("e"), unary);
	const variadic = VARIADIC[type];
	if (variadic) {
		const operands = inputs(model, frame, node, "operands");
		return fit(
			operands.reduce((a, b) => zip([a, b], variadic)),
			width,
		);
	}
	if (type === REPEAT_INPUT) {
		const zone = frame.zones.get(nodeId);
		if (!zone) throw new Error(`repeat input "${nodeId}" read outside its zone`);
		if (handleId === ITERATION_HANDLE) return [zone.iteration];
		return zone.state.get(handleId) ?? [0];
	}
	if (type === REPEAT_OUTPUT) return runZone(model, frame, node).get(handleId) ?? [0];
	const binary = BINARY[type];
	if (binary) return fit(zip([get(binary[0]), get(binary[1])], binary[2]), width);

	switch (type) {
		case "declare":
			return resolved.resolvedInputs.map((i) => get(i.id)[0] ?? 0);
		case "separate-vector":
			return [get("v")["xyzw".indexOf(handleId)] ?? 0];
		case "distance":
			return [Math.hypot(...zip([get("e1"), get("e2")], (a, b) => a - b))];
		case "not":
			return map(get("e"), (n) => Number(!n));
		case "boolean-math": {
			const op = BOOLEAN[node.data.settings?.op ?? "and"];
			return zip([get("a"), get("b")], (a, b) => Number(op?.(!!a, !!b)));
		}
		case "dot":
			return [zip([get("e1"), get("e2")], (a, b) => a * b).reduce((a, b) => a + b, 0)];
		case "length":
			return [Math.hypot(...get("e1"))];
		case "clamp":
			return zip([get("e"), get("low"), get("high")], (e, lo, hi) =>
				Math.min(hi, Math.max(lo, e)),
			);
		case "display-gamut-clip": {
			const [r = 0, g = 0, b = 0] = get("color");
			const clipped = clipToGamut({ r, g, b }, frame.colorSpace);
			return [clipped.r, clipped.g, clipped.b];
		}
		case "mix":
			return zip([get("e1"), get("e2"), get("e3")], (a, b, t) => a * (1 - t) + b * t);
		case "curve": {
			const points = node.data.curve ?? LINEAR_CURVE;
			const factor = get("factor")[0] ?? 0;
			return map(fit(get("value"), width), (x) => {
				const y = evaluateCurve(points, x);
				return x * (1 - factor) + y * factor;
			});
		}
		case "compare": {
			const op = COMPARE[node.data.settings?.op ?? "<"];
			return zip([get("a"), get("b")], (a, b) => Number(op?.(a, b)));
		}
		case "switch":
			return zip([get("condition"), get("false"), get("true")], (c, f, t) => (c ? t : f));
		case "fallback": {
			const edge = frame.doc.edgesByTarget
				.get(nodeId)
				?.find((e) => e.targetHandle === "value");
			return get(edge ? "value" : "default");
		}
		case "match": {
			const variants = model
				.resolveDescriptor(node)
				.inputs.filter((i) => i.id !== MATCH_SELECTOR);
			const selected = get(MATCH_SELECTOR)[0] ?? 0;
			const values = variants.map((i) => Number(i.id.slice("case-".length)));
			const value = enumValue(
				selected,
				values.map((v) => ({ value: v, label: "" })),
			);
			return get(caseHandle(value ?? 0));
		}
		default:
			throw new Error(`can't evaluate a "${type}" node`);
	}
}

/** Run a repeat zone to its end, as its loop does: every next value from the current ones. */
function runZone(model: GraphModel, frame: Frame, output: GraphNode): ReadonlyMap<string, Value> {
	const done = frame.finals.get(output.id);
	if (done) return done;
	const start = frame.doc.nodes.find(
		(n) => n.type === REPEAT_INPUT && n.data.pairedOutput === output.id,
	);
	if (!start) throw new Error(`no Repeat Input for "${output.id}"`);
	const items = zoneItems(output);
	const iterations = input(model, frame, start, ITERATIONS_HANDLE)[0] ?? 0;
	const count = Math.min(Math.max(0, Math.trunc(iterations)), zoneMaxIterations(start));
	let state: ReadonlyMap<string, Value> = new Map(
		items.map((item) => [item.id, input(model, frame, start, item.id)]),
	);
	for (let iteration = 0; iteration < count; iteration++) {
		const zones = new Map([...frame.zones, [start.id, { iteration, state }]]);
		const inner: Frame = { ...frame, zones, finals: new Map(), computed: new Map() };
		state = new Map(items.map((item) => [item.id, input(model, inner, output, item.id)]));
	}
	frame.finals.set(output.id, state);
	return state;
}
