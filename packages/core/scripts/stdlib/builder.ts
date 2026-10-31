// Describes standard-library groups in TypeScript, building the same graph
// documents the editor saves. The library's JSON files stay the source of
// truth: a description only produces them (see build.ts).
import { createHash } from "node:crypto";

import { MATCH, MATCH_SELECTOR, caseHandle } from "../../src/enums";
import type { GraphDocument, GraphDocumentEdge, GraphDocumentNode } from "../../src/graph/document";
import {
	type ColorDisplay,
	type EnumVariant,
	type GroupHandleDef,
	type HandleDef,
	type InputValue,
	type NodeData,
	WGSL_TYPES,
	type WgslType,
	familyKey,
} from "../../src/types";
import { ITERATIONS_HANDLE, ITERATION_HANDLE, REPEAT_INPUT, REPEAT_OUTPUT } from "../../src/zones";

/** An output socket of a node in the group being built. */
export type Ref = { readonly node: string; readonly handle: string };
/** What an input receives: a link from a socket, or a value stored on the node. */
export type Operand = Ref | InputValue;

/** An enum input of the group being built. */
export type EnumRef = Ref & { readonly variants: readonly EnumVariant[] };

export type GroupSpec = {
	id: string;
	name: string;
	aliases?: string[];
	category: string;
	/** Sections of the add menu it's in, under its category. */
	section?: string[];
	/** Section of search results it's listed in, after the main results. */
	searchSection?: string;
	build: (g: GroupBuilder) => void;
};

/** A group another one calls: one described in the same run, or a library entry by id. */
export type GroupTarget = GroupSpec | string;

/** A called group's definition ref and sockets, by the key it was described with. */
export type ResolvedGroup = {
	ref: string;
	inputs: ReadonlyMap<string, string>;
	outputs: ReadonlyMap<string, string>;
};

export type InputOptions = {
	label?: string;
	default?: InputValue;
	min?: number;
	max?: number;
	display?: ColorDisplay;
	/** Shown only while this variant of one of the group's enum inputs is picked. */
	owner?: { enum: EnumRef; value: number };
};

export function isRef(operand: Operand | undefined): operand is Ref {
	return typeof operand === "object" && "node" in operand && "handle" in operand;
}

/** A UUID-shaped id derived from `key`, so building twice gives the same files. */
export function stableId(key: string): string {
	const hex = createHash("sha1").update(key).digest("hex");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		`4${hex.slice(13, 16)}`,
		`${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
		hex.slice(20, 32),
	].join("-");
}

export function handleId(groupId: string, side: "in" | "out", key: string): string {
	return stableId(`${groupId}/${side}/${key}`);
}

export class GroupBuilder {
	readonly nodes: GraphDocumentNode[] = [];
	readonly edges: GraphDocumentEdge[] = [];
	readonly inputs: GroupHandleDef[] = [];
	readonly outputs: GroupHandleDef[] = [];
	readonly inputKeys = new Map<string, string>();
	readonly outputKeys = new Map<string, string>();
	readonly dependencies = new Set<string>();
	private readonly inputValues: Record<string, InputValue> = {};
	private count = 0;
	readonly inputNode: string;
	readonly outputNode: string;

	constructor(
		readonly id: string,
		private readonly resolve: (target: GroupTarget) => ResolvedGroup,
	) {
		this.inputNode = this.addNode("group-input", {});
		this.outputNode = this.addNode("group-output", {});
	}

	document(): GraphDocument {
		const nodes = this.nodes.map((n) => {
			if (n.id === this.inputNode) {
				const values =
					Object.keys(this.inputValues).length > 0 ? this.inputValues : undefined;
				return { ...n, data: { handles: this.inputs, ...(values ? { values } : {}) } };
			}
			if (n.id === this.outputNode) return { ...n, data: { handles: this.outputs } };
			return n;
		});
		return { nodes, edges: this.edges };
	}

	// ── Graph primitives ──────────────────────────────────────────────────

	private addNode(type: string, data: NodeData, group?: GraphDocumentNode["group"]): string {
		const id = stableId(`${this.id}/node/${String(this.count++)}`);
		this.nodes.push({ id, type, data, position: { x: 0, y: 0 }, ...(group ? { group } : {}) });
		return id;
	}

	private setData(nodeId: string, update: (data: NodeData) => NodeData) {
		const index = this.nodes.findIndex((n) => n.id === nodeId);
		const node = this.nodes[index];
		if (node) this.nodes[index] = { ...node, data: update(node.data) };
	}

	link(source: Ref, target: string, targetHandle: string) {
		this.edges.push({
			id: stableId(`${this.id}/edge/${String(this.edges.length)}`),
			source: source.node,
			sourceHandle: source.handle,
			target,
			targetHandle,
		});
	}

	/** Link or store `operand` on `nodeId`'s input `handle`. */
	private feed(nodeId: string, handle: string, operand: Operand) {
		if (isRef(operand)) {
			this.link(operand, nodeId, handle);
			return;
		}
		this.setData(nodeId, (data) => ({
			...data,
			values: { ...data.values, [handle]: operand },
		}));
	}

	/**
	 * A node of `type`, its inputs fed by handle id, returning its output
	 * `output`. A list feeds a variadic input; literals in it become
	 * Declare nodes (f32 unless given as `g.constant`).
	 */
	node(
		type: string,
		inputs: Record<string, Operand | Operand[]> = {},
		options: { output?: string; settings?: Record<string, string>; data?: NodeData } = {},
	): Ref {
		const data: NodeData = {
			...options.data,
			...(options.settings ? { settings: options.settings } : {}),
		};
		const id = this.addNode(type, data);
		for (const [handle, operand] of Object.entries(inputs)) {
			if (Array.isArray(operand)) {
				for (const each of operand) {
					this.link(isRef(each) ? each : this.constant("f32", each), id, handle);
				}
			} else {
				this.feed(id, handle, operand);
			}
		}
		return { node: id, handle: options.output ?? "result" };
	}

	/** Another output of the node `ref` belongs to. */
	out(ref: Ref, handle: string): Ref {
		return { node: ref.node, handle };
	}

	/** Give the node `ref` belongs to a name, shown instead of its type's. */
	named<R extends Ref>(label: string, ref: R): R {
		this.setData(ref.node, (data) => ({ ...data, label }));
		return ref;
	}

	// ── Boundary ──────────────────────────────────────────────────────────

	input(key: string, type: WgslType, options: InputOptions = {}): Ref {
		const id = handleId(this.id, "in", key);
		this.inputKeys.set(key, id);
		this.inputs.push({
			id,
			label: options.label ?? key,
			type,
			...(options.owner
				? { owner: { enumId: options.owner.enum.handle, value: options.owner.value } }
				: {}),
			...(options.min === undefined ? {} : { min: options.min }),
			...(options.max === undefined ? {} : { max: options.max }),
			...(options.display ? { display: options.display } : {}),
		});
		if (options.default !== undefined) this.inputValues[id] = options.default;
		return { node: this.inputNode, handle: id };
	}

	/** An enum input choosing among `variants` (`[value, label]`), picking `initial` by default. */
	enum(
		key: string,
		variants: readonly (readonly [number, string])[],
		initial: number,
		options: { label?: string } = {},
	): EnumRef {
		const id = handleId(this.id, "in", key);
		this.inputKeys.set(key, id);
		const list = variants.map(([value, label]) => ({ value, label }));
		this.inputs.push({ id, label: options.label ?? key, type: "u32", variants: list });
		this.inputValues[id] = initial;
		return { node: this.inputNode, handle: id, variants: list };
	}

	output(key: string, source: Operand, type: WgslType, options: { label?: string } = {}) {
		const id = handleId(this.id, "out", key);
		this.outputKeys.set(key, id);
		this.outputs.push({ id, label: options.label ?? key, type });
		this.feed(this.outputNode, id, source);
	}

	// ── Values ────────────────────────────────────────────────────────────

	/** A Declare node holding `value` as a `type`. */
	constant = (type: WgslType, value: InputValue): Ref => {
		const components = ["x", "y", "z", "w"];
		const values =
			typeof value === "object"
				? value
				: Object.fromEntries(components.map((c) => [c, value]));
		return this.node(
			"declare",
			{},
			{ output: "value", data: { types: { declare: type }, values } },
		);
	};

	/** A `type` vector (or scalar) made of `components`. */
	vec = (type: WgslType, ...components: Operand[]): Ref => {
		const ref = this.node(
			"declare",
			{},
			{ output: "value", data: { types: { declare: type } } },
		);
		components.forEach((c, i) => {
			this.feed(ref.node, ["x", "y", "z", "w"][i] ?? "x", c);
		});
		return ref;
	};

	split = (v: Operand): Record<"x" | "y" | "z" | "w", Ref> => {
		const ref = this.node("separate-vector", { v });
		return {
			x: this.out(ref, "x"),
			y: this.out(ref, "y"),
			z: this.out(ref, "z"),
			w: this.out(ref, "w"),
		};
	};

	uv = (): Ref => this.node("uv", {}, { output: "uv" });

	// ── Math ──────────────────────────────────────────────────────────────

	add = (...operands: Operand[]) => this.node("add", { operands });
	mul = (...operands: Operand[]) => this.node("mul", { operands });
	min = (...operands: Operand[]) => this.node("min", { operands });
	max = (...operands: Operand[]) => this.node("max", { operands });
	sub = (a: Operand, b: Operand) => this.node("sub", { a, b });
	div = (a: Operand, b: Operand) => this.node("div", { a, b });
	mod = (a: Operand, b: Operand) => this.node("mod", { a, b });
	pow = (a: Operand, b: Operand) => this.node("pow", { e1: a, e2: b });
	step = (edge: Operand, x: Operand) => this.node("step", { e1: edge, e2: x });
	floor = (e: Operand) => this.node("floor", { e });
	ceil = (e: Operand) => this.node("ceil", { e });
	fract = (e: Operand) => this.node("fract", { e });
	abs = (e: Operand) => this.node("abs", { e });
	sqrt = (e: Operand) => this.node("sqrt", { e });
	negate = (e: Operand) => this.node("negate", { e });
	mix = (a: Operand, b: Operand, t: Operand) => this.node("mix", { e1: a, e2: b, e3: t });
	clamp = (e: Operand, low: Operand, high: Operand) => this.node("clamp", { e, low, high });
	smoothstep = (low: Operand, high: Operand, x: Operand) =>
		this.node("smoothstep", { low, high, x });

	// ── Vectors ───────────────────────────────────────────────────────────

	dot = (a: Operand, b: Operand) => this.node("dot", { e1: a, e2: b });
	length = (v: Operand) => this.node("length", { e1: v });
	distance = (a: Operand, b: Operand) => this.node("distance", { e1: a, e2: b });
	normalize = (v: Operand) => this.node("normalize", { e: v });

	// ── Logic ─────────────────────────────────────────────────────────────

	compare = (a: Operand, op: "<" | "<=" | "==" | "!=" | ">=" | ">", b: Operand) =>
		this.node("compare", { a, b }, { settings: { op } });
	/** `ifTrue` where `condition` holds, `ifFalse` elsewhere (a Switch node). */
	select = (condition: Operand, ifFalse: Operand, ifTrue: Operand) =>
		this.node("switch", { condition, false: ifFalse, true: ifTrue });
	and = (a: Operand, b: Operand) =>
		this.node("boolean-math", { a, b }, { settings: { op: "and" } });
	or = (a: Operand, b: Operand) =>
		this.node("boolean-math", { a, b }, { settings: { op: "or" } });
	not = (e: Operand) => this.node("not", { e });
	fallback = (value: Operand, otherwise: Operand) =>
		this.node("fallback", { value, default: otherwise });

	/** The case of `cases` (by variant value) `selector` picks; `type` when no case decides it. */
	match = (selector: EnumRef, cases: Record<number, Operand>, type?: WgslType): Ref => {
		const ref = this.node(
			MATCH,
			{ [MATCH_SELECTOR]: selector },
			type ? { data: { types: { [familyKey(WGSL_TYPES)]: type } } } : {},
		);
		for (const [value, operand] of Object.entries(cases)) {
			this.feed(ref.node, caseHandle(Number(value)), operand);
		}
		return ref;
	};

	// ── Integers ──────────────────────────────────────────────────────────

	bitwise = (a: Operand, op: "&" | "|" | "^", b: Operand) =>
		this.node("bitwise", { a, b }, { settings: { op } });
	shift = (a: Operand, op: "<<" | ">>", b: Operand) =>
		this.node("bit-shift", { a, b }, { settings: { op } });
	toFloat = (e: Operand) => this.node("to-float", { e });
	toInt = (e: Operand) => this.node("to-int", { e });
	toUint = (e: Operand) => this.node("to-uint", { e });

	// ── Groups and zones ──────────────────────────────────────────────────

	/** A node of the group `target`, its inputs fed by key; its outputs by key. */
	call<O extends string = string>(
		target: GroupTarget,
		inputs: Record<string, Operand> = {},
	): Record<O, Ref> {
		const resolved = this.resolve(target);
		this.dependencies.add(resolved.ref);
		const id = this.addNode("node-group", {}, { definitionRef: resolved.ref, locked: true });
		for (const [key, operand] of Object.entries(inputs)) {
			const handle = resolved.inputs.get(key);
			if (!handle) throw new Error(`${this.id}: "${resolved.ref}" has no input "${key}"`);
			this.feed(id, handle, operand);
		}
		const outputs: Record<string, Ref> = {};
		for (const [key, handle] of resolved.outputs) outputs[key] = { node: id, handle };
		const checked: Record<O, Ref> = new Proxy(outputs, {
			get: (o, key: string) => {
				const ref = o[key];
				if (!ref) throw new Error(`${this.id}: "${resolved.ref}" has no output "${key}"`);
				return ref;
			},
		});
		return checked;
	}

	/**
	 * A repeat zone carrying `items` (`[type, initial value]`, by label):
	 * `body` gets the iteration index and the items' current values, and
	 * returns their next ones. Returns the items' final values.
	 */
	repeat<K extends string>(
		iterations: Operand,
		items: Record<K, readonly [WgslType, Operand]>,
		body: (iteration: Ref, state: Record<K, Ref>) => Record<K, Operand>,
	): Record<K, Ref> {
		const zone = this.count;
		const outputId = this.addNode(REPEAT_OUTPUT, {});
		const inputId = this.addNode(REPEAT_INPUT, { pairedOutput: outputId });
		this.feed(inputId, ITERATIONS_HANDLE, iterations);
		const keys = Object.keys(items) as K[];
		const handles = new Map<K, HandleDef>();
		for (const key of keys) {
			const [type, initial] = items[key];
			const handle = {
				id: stableId(`${this.id}/zone/${String(zone)}/${key}`),
				label: key,
				type,
			};
			handles.set(key, handle);
			this.feed(inputId, handle.id, initial);
		}
		this.setData(outputId, (data) => ({ ...data, items: [...handles.values()] }));
		const state = Object.fromEntries(
			keys.map((k) => [k, { node: inputId, handle: handles.get(k)?.id ?? "" }]),
		) as Record<K, Ref>;
		const next = body({ node: inputId, handle: ITERATION_HANDLE }, state);
		for (const key of keys) this.feed(outputId, handles.get(key)?.id ?? "", next[key]);
		return Object.fromEntries(
			keys.map((k) => [k, { node: outputId, handle: handles.get(k)?.id ?? "" }]),
		) as Record<K, Ref>;
	}
}
