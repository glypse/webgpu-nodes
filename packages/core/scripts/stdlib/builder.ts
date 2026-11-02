// Describes standard-library groups in TypeScript, building the same graph
// documents the editor saves. The library's JSON files stay the source of
// truth: a description only produces them (see build.ts).
import { createHash } from "node:crypto";

import {
	caseHandle,
	CASES_FAMILY,
	MATCH,
	MATCH_SELECTOR,
	WIDTH_SWITCH,
	WIDTH_SWITCH_VALUE,
} from "../../src/enums";
import { type FrameTint, LAYOUT_FRAME } from "../../src/frames";
import { rerouteBranches } from "../../src/graph/branches";
import type { GraphDocument, GraphDocumentEdge, GraphDocumentNode } from "../../src/graph/document";
import { CUSTOM_WGSL } from "../../src/nodes/custom";
import { INDEX_SWITCH, INDEX_SWITCH_INDEX } from "../../src/nodes/index-switch";
import {
	type NodeDescriptors,
	nodeRegistry,
	type NodeType,
	registeredNodes,
} from "../../src/nodes/registry";
import {
	type ColorDisplay,
	type EnumVariant,
	type GroupHandleDef,
	type InputValue,
	type NodeData,
	type NodeInputDef,
	type NodeWidget,
	type SocketType,
	type TypeVariable,
	type WgslType,
	type ZoneItem,
} from "../../src/types";
import { ITERATION_HANDLE, ITERATIONS_HANDLE, REPEAT_INPUT, REPEAT_OUTPUT } from "../../src/zones";

/**
 * An output socket of a node in the group being built. A group input's is
 * on no node yet (`GROUP_INPUT`): it's linked from the Group Input node of
 * wherever it's used (see `GroupBuilder.frame`).
 */
export type Ref = { readonly node: string; readonly handle: string };

const GROUP_INPUT = "\0group-input";
/** What an input receives: a link from a socket, or a value stored on the node. */
export type Operand = Ref | InputValue;

/** The type of a group's type variable, as its sockets and zone items take it. */
export type VariableType = { readonly variable: string };

/** A zone item's type: a fixed one, or a type variable's. */
export type ItemType = ZoneItem["type"];

/** An enum input of the group being built. */
export type EnumRef = Ref & { readonly variants: readonly EnumVariant[] };

/**
 * A group described in TypeScript. `inputs` and `outputs` are the keys
 * `build` gives its inputs and outputs (in any order): they type what
 * `build` may add and what a group calling it may link.
 */
export type GroupSpec<I extends string = string, O extends string = string> = {
	id: string;
	name: string;
	aliases?: string[];
	category: string;
	/** Sections of the add menu it's in, under its category. */
	section?: string[];
	/** Section of search results it's listed in, after the main results. */
	searchSection?: string;
	inputs: readonly I[];
	outputs: readonly O[];
	build(g: GroupBuilder<I, O>): void;
	/** The widget its nodes draw, given the handle id of each input by key. */
	widget?(input: (key: I) => string): NodeWidget;
};

/** `spec`, its input and output keys kept in its type. */
export function group<const I extends string, const O extends string>(
	spec: GroupSpec<I, O>,
): GroupSpec<I, O> {
	return spec;
}

/**
 * Where a helper group is listed: in the add menu's Helpers section of its
 * category (under `path`), and after the main search results.
 */
export function helpers(...path: string[]): Pick<GroupSpec, "section" | "searchSection"> {
	return { section: ["Helpers", ...path], searchSection: "Helpers" };
}

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
	typeOwner?: TypeOwnerOption;
};

/** Shown only while the type variable `variable` has one of `types`. */
export type TypeOwnerOption = { variable: VariableType; types: readonly WgslType[] };

function typeOwnerOf(option: TypeOwnerOption | undefined) {
	return option
		? { typeOwner: { variable: option.variable.variable, types: [...option.types] } }
		: {};
}

export function isRef(operand: Operand | undefined): operand is Ref {
	return typeof operand === "object" && "node" in operand && "handle" in operand;
}

function isOperandList(operand: Operand | readonly Operand[]): operand is readonly Operand[] {
	return Array.isArray(operand);
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

// ── Node types ───────────────────────────────────────────────────────────

type Registered = keyof NodeDescriptors;
type InputsOf<T extends Registered> = NodeDescriptors[T]["inputs"];
type OutputId<T extends Registered> = NodeDescriptors[T]["outputs"][number]["id"];

/** What feeds each input of a `T` node, by id: a list for a variadic one. */
export type Feeds<T extends Registered> = {
	readonly [D in InputsOf<T>[number] as D["id"]]?: D extends { variadic: true }
		? readonly Operand[]
		: Operand;
};

/** The settings of a `T` node, by key. */
export type Settings<T extends Registered> = {
	readonly [
		S in NonNullable<NodeDescriptors[T]["settings"]>[number] as S["key"]
	]?: S["options"][number]["value"];
};

/**
 * Node types the builder adds by methods of their own (taking more than
 * operands), or that have no place in a group.
 */
const OWN_NODES = [
	"declare",
	"reroute",
	LAYOUT_FRAME,
	"frag-output",
	"node-group",
	MATCH,
	INDEX_SWITCH,
	CUSTOM_WGSL,
	WIDTH_SWITCH,
	"test-invalid-wgsl",
	"test-runtime-error",
] as const satisfies Registered[];

type OperatorType = Exclude<Registered, (typeof OWN_NODES)[number]>;

/** Operands for `inputs` in order, a variadic (last) one taking the rest. */
type Positional<In extends readonly NodeInputDef[]> = In extends readonly [
	infer D,
	...infer Rest extends readonly NodeInputDef[],
]
	? D extends { variadic: true }
		? Rest extends readonly []
			? Operand[]
			: never
		: [Operand, ...Positional<Rest>]
	: In extends readonly []
		? []
		: Operand[];

/** An operator's arguments: its operands, then its settings (optional unless after a variadic). */
type OperatorArgs<T extends OperatorType> = [keyof Settings<T>] extends [never]
	? Positional<InputsOf<T>>
	: number extends Positional<InputsOf<T>>["length"]
		? [...Positional<InputsOf<T>>, Settings<T>]
		: [...Positional<InputsOf<T>>, Settings<T>?];

/** A node's output when it has one, all of them by id otherwise. */
type OperatorResult<T extends OperatorType> = NodeDescriptors[T]["outputs"] extends readonly [
	unknown,
]
	? Ref
	: Record<OutputId<T>, Ref>;

type CamelCase<S extends string> = S extends `${infer Head}-${infer Rest}`
	? `${Head}${Capitalize<CamelCase<Rest>>}`
	: S;

const camelCase = (type: string) => type.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * A method per node type (named after it in camelCase), adding a node fed
 * by its operands in its inputs' order, then its settings.
 */
export type Operators = {
	readonly [T in OperatorType as CamelCase<T>]: (...args: OperatorArgs<T>) => OperatorResult<T>;
};

/** Fails to typecheck when one of the builder's own members hides an operator. */
export const OPERATORS_UNSHADOWED: [
	Extract<keyof Operators, keyof Builder<string, string>>,
] extends [never]
	? true
	: never = true;

// ── Builder ──────────────────────────────────────────────────────────────

class Builder<I extends string, O extends string> {
	readonly nodes: GraphDocumentNode[] = [];
	readonly edges: GraphDocumentEdge[] = [];
	readonly handles: { inputs: GroupHandleDef[]; outputs: GroupHandleDef[] } = {
		inputs: [],
		outputs: [],
	};
	readonly inputKeys = new Map<I, string>();
	readonly outputKeys = new Map<O, string>();
	readonly dependencies = new Set<string>();
	private readonly typeVariables: TypeVariable[] = [];
	private readonly inputValues: Record<string, InputValue> = {};
	private count = 0;
	/** The frames being described, outermost first. */
	private readonly frames: string[] = [];
	/** Group Input and Group Output nodes, by side and the top-level frame they're in. */
	private readonly boundaries = new Map<string, string>();

	constructor(
		readonly id: string,
		private readonly resolve: (target: GroupSpec) => ResolvedGroup,
	) {}

	/** The group described, each output linked to several inputs split at a reroute. */
	document(): GraphDocument {
		const defaults = Object.keys(this.inputValues).length > 0 ? this.inputValues : undefined;
		const { reroutes, links, moved } = rerouteBranches(
			this.nodes,
			this.edges,
			() => true,
			(key) => stableId(`${this.id}/branch/${key}`),
		);
		const movedById = new Map(moved.map((e) => [e.id, e]));
		return {
			nodes: [...this.nodes, ...reroutes],
			edges: [...this.edges.map((e) => movedById.get(e.id) ?? e), ...links],
			inputs: this.handles.inputs,
			outputs: this.handles.outputs,
			...(defaults ? { defaults } : {}),
			...(this.typeVariables.length > 0 ? { typeVariables: this.typeVariables } : {}),
		};
	}

	// ── Graph primitives ──────────────────────────────────────────────────

	private addNode(
		type: NodeType,
		data: NodeData,
		group?: GraphDocumentNode["group"],
		frame = this.frames.at(-1),
	): string {
		const id = stableId(`${this.id}/node/${String(this.count++)}`);
		this.nodes.push({
			id,
			type,
			data,
			position: { x: 0, y: 0 },
			...(group ? { group } : {}),
			...(frame ? { frame } : {}),
		});
		return id;
	}

	/**
	 * The Group Input or Group Output node of the top-level frame being
	 * described (or of none), added the first time it's needed. Each shows
	 * only its linked sockets.
	 */
	private boundary(type: "group-input" | "group-output"): string {
		const frame = this.frames[0];
		const key = `${type}/${frame ?? ""}`;
		const existing = this.boundaries.get(key);
		if (existing) return existing;
		const id = this.addNode(type, { hideUnlinked: true }, undefined, frame);
		this.boundaries.set(key, id);
		return id;
	}

	private setData(nodeId: string, update: (data: NodeData) => NodeData) {
		const index = this.nodes.findIndex((n) => n.id === nodeId);
		const node = this.nodes[index];
		if (node) this.nodes[index] = { ...node, data: update(node.data) };
	}

	private link(source: Ref, target: string, targetHandle: string) {
		this.edges.push({
			id: stableId(`${this.id}/edge/${String(this.edges.length)}`),
			source: source.node === GROUP_INPUT ? this.boundary("group-input") : source.node,
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
	 * A node of `type`, its inputs fed by id, returning its output `output`
	 * (its first by default). Literals in a variadic input's list become
	 * Declare nodes (f32 unless given as `g.constant`).
	 */
	node<T extends Registered>(
		type: T,
		inputs: Feeds<T> = {},
		options: { output?: OutputId<T>; settings?: Settings<T>; data?: NodeData } = {},
	): Ref {
		const settings: Record<string, string> = {};
		for (const [key, value] of Object.entries<string | undefined>(options.settings ?? {})) {
			if (value !== undefined) settings[key] = value;
		}
		return this.fedNode(type, Object.entries(inputs), {
			...options,
			settings,
		});
	}

	private fedNode(
		type: Registered,
		inputs: readonly (readonly [string, Operand | readonly Operand[] | undefined])[],
		options: { output?: string; settings: Record<string, string>; data?: NodeData },
	): Ref {
		const hasSettings = Object.keys(options.settings).length > 0;
		const id = this.addNode(type, {
			...options.data,
			...(hasSettings ? { settings: options.settings } : {}),
		});
		for (const [handle, operand] of inputs) {
			if (operand === undefined) continue;
			if (isOperandList(operand)) {
				for (const each of operand) {
					this.link(isRef(each) ? each : this.constant("f32", each), id, handle);
				}
			} else {
				this.feed(id, handle, operand);
			}
		}
		const output = options.output ?? nodeRegistry[type]?.outputs[0]?.id;
		if (output === undefined) throw new Error(`${this.id}: a ${type} node has no output`);
		return { node: id, handle: output };
	}

	/** An operator node of `type`, fed `args` as `Operators` describes. */
	operator(type: OperatorType, args: readonly (Operand | Settings<OperatorType>)[]) {
		const descriptor = nodeRegistry[type];
		if (!descriptor) throw new Error(`no node type "${type}"`);
		const { inputs, outputs } = descriptor;
		const variadic = inputs.some((i) => i.variadic);
		const takesSettings =
			(descriptor.settings?.length ?? 0) > 0 && (variadic || args.length > inputs.length);
		// `Operators` puts the settings last, and only there.
		const operands = (takesSettings ? args.slice(0, -1) : args) as readonly Operand[];
		const settings = takesSettings ? (args.at(-1) as Record<string, string>) : {};
		const ref = this.fedNode(
			type,
			inputs.map((input, i) => [input.id, input.variadic ? operands.slice(i) : operands[i]]),
			{ settings },
		);
		if (outputs.length === 1) return ref;
		return Object.fromEntries(outputs.map((o) => [o.id, this.out(ref, o.id)]));
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

	/** A type the sockets typed with it share, decided per group node among `types`. */
	typeVariable(key: string, name: string, types: readonly WgslType[]): VariableType {
		const id = stableId(`${this.id}/type/${key}`);
		if (this.typeVariables.some((v) => v.id === id)) {
			throw new Error(`${this.id}: type variable "${key}" declared twice`);
		}
		this.typeVariables.push({ id, name, types });
		return { variable: id };
	}

	private addInput(key: I, def: Omit<GroupHandleDef, "id">): string {
		if (this.inputKeys.has(key)) throw new Error(`${this.id}: input "${key}" added twice`);
		const id = handleId(this.id, "in", key);
		this.inputKeys.set(key, id);
		this.handles.inputs.push({ id, ...def });
		return id;
	}

	input(key: I, type: SocketType, options: InputOptions = {}): Ref {
		const id = this.addInput(key, {
			label: options.label ?? key,
			type,
			...(options.owner
				? { owner: { enumId: options.owner.enum.handle, value: options.owner.value } }
				: {}),
			...(options.min === undefined ? {} : { min: options.min }),
			...(options.max === undefined ? {} : { max: options.max }),
			...(options.display ? { display: options.display } : {}),
			...typeOwnerOf(options.typeOwner),
		});
		if (options.default !== undefined) this.inputValues[id] = options.default;
		return { node: GROUP_INPUT, handle: id };
	}

	/** An enum input choosing among `variants` (`[value, label]`), picking `initial` by default. */
	/**
	 * An enum input of `variants` (value, label, and the types of
	 * `options.variantsBy` a variant is offered for, all without), `initial`
	 * by default.
	 */
	enum(
		key: I,
		variants: readonly (readonly [number, string, (readonly WgslType[])?])[],
		initial: number,
		options: { label?: string; typeOwner?: TypeOwnerOption; variantsBy?: VariableType } = {},
	): EnumRef {
		const by = options.variantsBy;
		const list: EnumVariant[] = variants.map(([value, label, types]) => ({
			value,
			label,
			...(by && types ? { typeOwner: { variable: by.variable, types: [...types] } } : {}),
		}));
		const id = this.addInput(key, {
			label: options.label ?? key,
			type: "u32",
			variants: list,
			...typeOwnerOf(options.typeOwner),
		});
		this.inputValues[id] = initial;
		return { node: GROUP_INPUT, handle: id, variants: list };
	}

	output(key: O, source: Operand, type: SocketType, options: { label?: string } = {}): void {
		if (this.outputKeys.has(key)) throw new Error(`${this.id}: output "${key}" added twice`);
		const id = handleId(this.id, "out", key);
		this.outputKeys.set(key, id);
		this.handles.outputs.push({ id, label: options.label ?? key, type });
		this.feed(this.boundary("group-output"), id, source);
	}

	// ── Organisation ──────────────────────────────────────────────────────

	/**
	 * A frame labelled `label` around the nodes `body` adds (nested frames
	 * included), returning what `body` does. Group inputs used and outputs
	 * given inside a top-level frame come from Group Input and Group
	 * Output nodes of its own.
	 */
	frame<T>(label: string, options: { note?: string; tint?: FrameTint }, body: () => T): T {
		const id = this.addNode(LAYOUT_FRAME, { label, ...options });
		this.frames.push(id);
		try {
			return body();
		} finally {
			this.frames.pop();
		}
	}

	/**
	 * A reroute named `label` passing `source` on, its links drawn as tags:
	 * for a value used far from where it's computed.
	 */
	wireless(label: string, source: Ref): Ref {
		return this.node("reroute", { in: source }, { data: { label, hideLinks: true } });
	}

	// ── Values ────────────────────────────────────────────────────────────

	/** A Declare node holding `value` as a `type`. */
	constant(type: WgslType, value: InputValue): Ref {
		const values =
			typeof value === "object" ? value : { x: value, y: value, z: value, w: value };
		return this.node("declare", {}, { data: { types: { declare: type }, values } });
	}

	/** A `type` vector (or scalar) made of `components`. */
	vec(type: WgslType, ...components: [Operand, Operand?, Operand?, Operand?]): Ref {
		const [x, y, z, w] = components;
		return this.node(
			"declare",
			{
				x,
				...(y === undefined ? {} : { y }),
				...(z === undefined ? {} : { z }),
				...(w === undefined ? {} : { w }),
			},
			{ data: { types: { declare: type } } },
		);
	}

	/**
	 * The case of `cases` (by component count) `value`'s type picks; with
	 * `type`, every case is converted to it.
	 */
	widthSwitch(value: Operand, cases: Record<1 | 2 | 3 | 4, Operand>, type?: WgslType): Ref {
		const handles = Object.keys(cases).map((n) => caseHandle(Number(n)));
		const ref = this.node(
			WIDTH_SWITCH,
			{ [WIDTH_SWITCH_VALUE]: value },
			type ? { data: { types: Object.fromEntries(handles.map((h) => [h, type])) } } : {},
		);
		for (const [n, operand] of Object.entries(cases)) {
			this.feed(ref.node, caseHandle(Number(n)), operand);
		}
		return ref;
	}

	/** The case of `cases` (by variant value) `selector` picks; `type` when no case decides it. */
	match(selector: EnumRef, cases: Record<number, Operand>, type?: WgslType): Ref {
		const ref = this.node(
			MATCH,
			{ [MATCH_SELECTOR]: selector },
			type ? { data: { types: { [CASES_FAMILY]: type } } } : {},
		);
		for (const [value, operand] of Object.entries(cases)) {
			this.feed(ref.node, caseHandle(Number(value)), operand);
		}
		return ref;
	}

	/** The case of `cases` at `index` (a table read at runtime), all of them `type`. */
	indexSwitch(index: Operand, cases: readonly Operand[], type: WgslType): Ref {
		const ref = this.node(
			INDEX_SWITCH,
			{ [INDEX_SWITCH_INDEX]: index },
			{ data: { cases: cases.length, types: { [CASES_FAMILY]: type } } },
		);
		cases.forEach((operand, i) => {
			this.feed(ref.node, caseHandle(i), operand);
		});
		return ref;
	}

	// ── Groups and zones ──────────────────────────────────────────────────

	/** A node of the group `target`, its inputs fed by key; its outputs by key. */
	call<CI extends string, CO extends string>(
		target: GroupSpec<CI, CO>,
		inputs: Partial<Readonly<Record<CI, Operand>>> = {},
	): Record<CO, Ref> {
		const resolved = this.resolve(target);
		this.dependencies.add(resolved.ref);
		const id = this.addNode("node-group", {}, { definitionRef: resolved.ref, locked: true });
		const fed: [string, Operand | undefined][] = Object.entries(inputs);
		for (const [key, operand] of fed) {
			const handle = resolved.inputs.get(key);
			if (!handle) throw new Error(`${this.id}: "${resolved.ref}" has no input "${key}"`);
			if (operand !== undefined) this.feed(id, handle, operand);
		}
		// Every key of CO is one of the spec's outputs, all of them built.
		const outputs: Record<string, Ref> = {};
		for (const [key, handle] of resolved.outputs) outputs[key] = { node: id, handle };
		return outputs;
	}

	/**
	 * A repeat zone carrying `items` (`[type, initial value]`, by label):
	 * `body` gets the iteration index and the items' current values, and
	 * returns their next ones. Returns the items' final values.
	 */
	repeat<K extends string>(
		iterations: Operand,
		items: Record<K, readonly [ItemType, Operand]>,
		body: (iteration: Ref, state: Record<K, Ref>) => Record<K, Operand>,
	): Record<K, Ref> {
		const zone = this.count;
		const outputId = this.addNode(REPEAT_OUTPUT, {});
		const inputId = this.addNode(REPEAT_INPUT, { pairedOutput: outputId });
		this.feed(inputId, ITERATIONS_HANDLE, iterations);
		const keys = Object.keys(items) as K[];
		const handles = new Map<K, ZoneItem>();
		for (const key of keys) {
			const [type, initial] = items[key];
			const handle: ZoneItem = {
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

/** Builds a group's document: its own methods, and a node operator per node type. */
export type GroupBuilder<I extends string = string, O extends string = string> = Builder<I, O> &
	Operators;

export function groupBuilder<I extends string, O extends string>(
	id: string,
	resolve: (target: GroupSpec) => ResolvedGroup,
): GroupBuilder<I, O> {
	const builder = new Builder<I, O>(id, resolve);
	const operators: Record<string, (...args: (Operand | Settings<OperatorType>)[]) => unknown> =
		{};
	const own = new Set<string>(OWN_NODES);
	for (const [type] of registeredNodes()) {
		if (own.has(type)) continue;
		operators[camelCase(type)] = (...args) => builder.operator(type as OperatorType, args);
	}
	// `Operators` types each of these after its node type's descriptor.
	return Object.assign(builder, operators as unknown as Operators);
}
