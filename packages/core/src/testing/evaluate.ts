import { MATCH_SELECTOR, caseHandle } from "../enums";
import type { GraphNode, HydratedGraphDocument } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { componentKeys, readComponent } from "../graph/values";
import { enumValue, typeComponents } from "../types";

/** A value as its components. */
export type Value = number[];

type Frame = { doc: HydratedGraphDocument; groupInputs: ReadonlyMap<string, Value> };

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

/**
 * Compute an output of a node of the root document on the CPU, for the
 * node types the standard library's maths uses. Throws on any other.
 */
export function evaluate(model: GraphModel, nodeId: string, handleId: string): Value {
	return output(model, { doc: model.root, groupInputs: new Map() }, nodeId, handleId);
}

function input(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value {
	const width = typeComponents(model.resolveInputType(node.id, inputId));
	const edge = frame.doc.edgesByTarget.get(node.id)?.find((e) => e.targetHandle === inputId);
	if (edge) return fit(output(model, frame, edge.source, edge.sourceHandle), width);
	const stored =
		node.data.values?.[inputId] ?? model.resolveDescriptor(node).defaultData.values?.[inputId];
	const keys = componentKeys(model.resolveInputType(node.id, inputId));
	return keys.map((k) => readComponent(stored, k));
}

function inputs(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value[] {
	const edges = frame.doc.edgesByTarget.get(node.id)?.filter((e) => e.targetHandle === inputId);
	return (edges ?? []).map((e) => output(model, frame, e.source, e.sourceHandle));
}

function output(model: GraphModel, frame: Frame, nodeId: string, handleId: string): Value {
	const node = frame.doc.nodesById.get(nodeId);
	if (!node?.type) throw new Error(`no node "${nodeId}"`);
	const type = node.type;
	const get = (id: string) => input(model, frame, node, id);
	const width = typeComponents(model.resolveOutputHandleType(nodeId, handleId));

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
		const inner = { doc, groupInputs };
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
	const binary = BINARY[type];
	if (binary) return fit(zip([get(binary[0]), get(binary[1])], binary[2]), width);

	switch (type) {
		case "declare":
			return model.resolveNodeInputs(nodeId).map((i) => get(i.id)[0] ?? 0);
		case "separate-vector":
			return [get("v")["xyzw".indexOf(handleId)] ?? 0];
		case "dot":
			return [zip([get("e1"), get("e2")], (a, b) => a * b).reduce((a, b) => a + b, 0)];
		case "length":
			return [Math.hypot(...get("e1"))];
		case "clamp":
			return zip([get("e"), get("low"), get("high")], (e, lo, hi) =>
				Math.min(hi, Math.max(lo, e)),
			);
		case "mix":
			return zip([get("e1"), get("e2"), get("e3")], (a, b, t) => a * (1 - t) + b * t);
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
