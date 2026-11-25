import {
	BOOL_TYPES,
	defineNode,
	defineSetting,
	makeType,
	NUMERIC_TYPES,
	settingValue,
	typeComponents,
	WGSL_TYPES,
} from "../types";
import { binaryNode, unaryFn } from "./builders";
import { coerce, unaryCpu, zip } from "./cpu";
import { SAMPLE_TEXTURE, SAMPLE_TEXTURE_UV } from "./texture";

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
	"<": (a, b) => a < b,
	"<=": (a, b) => a <= b,
	"==": (a, b) => a === b,
	"!=": (a, b) => a !== b,
	">=": (a, b) => a >= b,
	">": (a, b) => a > b,
};

const COMPARE_SETTING = defineSetting({
	key: "op",
	label: "Operation",
	options: [
		{ value: "<", label: "Less Than" },
		{ value: "<=", label: "Less Than or Equal" },
		{ value: "==", label: "Equal" },
		{ value: "!=", label: "Not Equal" },
		{ value: ">=", label: "Greater Than or Equal" },
		{ value: ">", label: "Greater Than" },
	],
});

export const compareNode = defineNode({
	type: "compare",
	label: "Compare",
	aliases: ["Greater Than", "Less Than", "Equal", "Not Equal", "Comparison", "If"],
	category: "logic",
	inputs: [
		{ id: "a", label: "a", types: NUMERIC_TYPES },
		{ id: "b", label: "b", types: NUMERIC_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "bool" }],
	defaultData: { values: { a: 0, b: 0 }, settings: { op: "<" } },
	settings: [COMPARE_SETTING],
	resolveOutputType: (t) => makeType("bool", typeComponents(t)),
	cpu: (ctx) => {
		const op = COMPARE[settingValue(ctx.data, COMPARE_SETTING)];
		return {
			result: coerce(
				zip([ctx.input("a"), ctx.input("b")], (a, b) => Number(op?.(a, b))),
				ctx.outputType,
			),
		};
	},
	wgsl: (ctx) => {
		const op = settingValue(ctx.data, COMPARE_SETTING);
		return [`let ${ctx.varName} = ${ctx.promoteInput("a")} ${op} ${ctx.promoteInput("b")};`];
	},
});

export const switchNode = defineNode({
	type: "switch",
	label: "Switch",
	aliases: ["If", "Select", "Branch", "Conditional", "Ternary", "Static Switch"],
	category: "logic",
	primaryInput: "false",
	inputs: [
		{ id: "condition", label: "condition", types: BOOL_TYPES },
		{ id: "false", label: "false", types: WGSL_TYPES },
		{ id: "true", label: "true", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { values: { condition: false, false: 0, true: 1 } },
	cpu: (ctx) => ({
		result: coerce(
			zip([ctx.input("condition"), ctx.input("false"), ctx.input("true")], (c, f, t) =>
				c ? t : f,
			),
			ctx.outputType,
		),
	}),
	wgsl: (ctx) => {
		const valueType = ctx.outputType;
		const conditionType = ctx.inputTypes.condition ?? "bool";
		let condition = ctx.promoteInput("condition");
		// `select` takes either a scalar bool or a bool vector of the value's width.
		if (typeComponents(conditionType) !== 1) {
			const target = makeType("bool", typeComponents(valueType));
			condition = ctx.convert(condition, conditionType, target);
		}
		return [
			`let ${ctx.varName} = select(${ctx.promoteInput("false")}, ${ctx.promoteInput("true")}, ${condition});`,
		];
	},
});

const BOOLEAN_MATH_SETTING = defineSetting({
	key: "op",
	label: "Operation",
	options: [
		{ value: "and", label: "And" },
		{ value: "or", label: "Or" },
		{ value: "xor", label: "Xor" },
		{ value: "nand", label: "Nand" },
		{ value: "nor", label: "Nor" },
		{ value: "xnor", label: "Xnor" },
	],
});

const BOOLEAN_MATH_EXPR: Record<string, (a: string, b: string) => string> = {
	and: (a, b) => `${a} & ${b}`,
	or: (a, b) => `${a} | ${b}`,
	xor: (a, b) => `${a} != ${b}`,
	nand: (a, b) => `!(${a} & ${b})`,
	nor: (a, b) => `!(${a} | ${b})`,
	xnor: (a, b) => `${a} == ${b}`,
};

const BOOLEAN_MATH: Record<string, (a: boolean, b: boolean) => boolean> = {
	and: (a, b) => a && b,
	or: (a, b) => a || b,
	xor: (a, b) => a !== b,
	nand: (a, b) => !(a && b),
	nor: (a, b) => !(a || b),
	xnor: (a, b) => a === b,
};

export const booleanMathNode = defineNode({
	...binaryNode(
		"boolean-math",
		"Boolean Math",
		(a, b, ctx) => {
			const emit = BOOLEAN_MATH_EXPR[settingValue(ctx.data, BOOLEAN_MATH_SETTING)];
			return emit ? emit(a, b) : `${a} & ${b}`;
		},
		{ types: BOOL_TYPES, category: "logic" },
	),
	cpu: (ctx) => {
		const op = BOOLEAN_MATH[settingValue(ctx.data, BOOLEAN_MATH_SETTING)];
		return {
			result: coerce(
				zip([ctx.input("a"), ctx.input("b")], (a, b) => Number(op?.(!!a, !!b))),
				ctx.outputType,
			),
		};
	},
	aliases: ["And", "Or", "Xor", "Nand", "Nor", "Logic"],
	defaultData: { values: { a: false, b: false }, settings: { op: "and" } },
	settings: [BOOLEAN_MATH_SETTING],
});

export const notNode = defineNode({
	...unaryFn("not", "Not", "", BOOL_TYPES, "logic"),
	aliases: ["Logical Not", "Boolean Not", "Invert Boolean"],
	defaultData: { values: { e: false } },
	cpu: unaryCpu((n) => Number(!n)),
	wgsl: (ctx) => [`let ${ctx.varName} = !(${ctx.promoteInput("e")});`],
});

const REDUCE_SETTING = defineSetting({
	key: "op",
	label: "Operation",
	options: [
		{ value: "any", label: "Any" },
		{ value: "all", label: "All" },
	],
});

export const reduceBooleanNode = defineNode({
	...unaryFn("reduce-boolean", "Any / All", "", BOOL_TYPES, "logic"),
	aliases: ["Reduce"],
	defaultData: { values: { e: false }, settings: { op: "any" } },
	settings: [REDUCE_SETTING],
	resolveOutputType: () => "bool",
	cpu: (ctx) => {
		const values = ctx.input("e");
		const any = settingValue(ctx.data, REDUCE_SETTING) === "any";
		return { result: [Number(any ? values.some(Boolean) : values.every(Boolean))] };
	},
	wgsl: (ctx) => [
		`let ${ctx.varName} = ${settingValue(ctx.data, REDUCE_SETTING)}(${ctx.promoteInput("e")});`,
	],
});

/**
 * Use `value` if it carries one, `default` otherwise. Presence is known while
 * compiling (it's never a runtime "null"): `value` is absent when nothing
 * feeds it, or when it comes from a group input whose socket the calling
 * group node left unlinked. Only the chosen branch is used, so a group can
 * compute its own default (e.g. the fragment's UV) for an unlinked input.
 */
export const fallbackNode = defineNode({
	type: "fallback",
	label: "Fallback",
	aliases: ["Default Value", "Coalesce", "Optional"],
	category: "logic",
	inputs: [
		{ id: "value", label: "value", types: WGSL_TYPES },
		{ id: "default", label: "default", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { values: { default: 0 } },
	cpu: (ctx) => ({
		result: coerce(ctx.input(ctx.isPresent("value") ? "value" : "default"), ctx.outputType),
	}),
	wgsl: (ctx) => {
		const chosen = ctx.isPresent("value") ? "value" : "default";
		return [`let ${ctx.varName} = ${ctx.promoteInput(chosen)};`];
	},
});

type FallbackDocument = {
	nodes: readonly { id: string; type?: string; group?: { definitionRef: string } }[];
	edges: readonly {
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle: string;
	}[];
};

type FallbackEntry = {
	edges: FallbackDocument["edges"];
	/** The definitions it was found through, which it's out of date without. */
	used: ReadonlyMap<string, FallbackDocument | undefined>;
	ids: Set<string>;
};

const fallbackHandles = new WeakMap<FallbackDocument["nodes"], FallbackEntry>();

function currentFallbacks(
	{ nodes, edges }: FallbackDocument,
	definitions: ReadonlyMap<string, FallbackDocument>,
): Set<string> | undefined {
	const known = fallbackHandles.get(nodes);
	if (known?.edges !== edges) return undefined;
	for (const [ref, doc] of known.used) {
		if (definitions.get(ref) !== doc) return undefined;
		if (doc && !currentFallbacks(doc, definitions)) return undefined;
	}
	return known.ids;
}

/**
 * Group-input handles of a definition whose value goes straight (through
 * reroutes at most) into a Fallback node, or into a fallback input of a
 * nested group: unlinked on a group node, they fall back to the group's own
 * default instead of showing an editor. Memoised on the documents' arrays,
 * which edits replace.
 */
export function fallbackHandleIds(
	definition: FallbackDocument,
	definitions: ReadonlyMap<string, FallbackDocument> = new Map(),
	visiting: ReadonlySet<FallbackDocument> = new Set(),
): Set<string> {
	const known = currentFallbacks(definition, definitions);
	if (known) return known;
	const used = new Map<string, FallbackDocument | undefined>();
	const ids = computeFallbackHandles(definition, definitions, visiting, used);
	// What nests itself is found without the group being visited, which isn't to be kept.
	if ([...used.values()].some((doc) => doc && (doc === definition || visiting.has(doc))))
		return ids;
	fallbackHandles.set(definition.nodes, { edges: definition.edges, used, ids });
	return ids;
}

function computeFallbackHandles(
	definition: FallbackDocument,
	definitions: ReadonlyMap<string, FallbackDocument>,
	visiting: ReadonlySet<FallbackDocument>,
	used: Map<string, FallbackDocument | undefined>,
): Set<string> {
	const inputIds = new Set(
		definition.nodes.filter((n) => n.type === "group-input").map((n) => n.id),
	);
	const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
	const nested = new Map<string, Set<string>>();
	const isFallback = (target: string, handle: string): boolean => {
		const node = nodesById.get(target);
		if (node?.type === "fallback") return handle === "value";
		if (node?.type === SAMPLE_TEXTURE) return handle === SAMPLE_TEXTURE_UV;
		if (node?.type === "reroute") {
			return definition.edges.some(
				(e) => e.source === target && isFallback(e.target, e.targetHandle),
			);
		}
		const ref = node?.type === "node-group" ? node.group?.definitionRef : undefined;
		const inner = ref === undefined ? undefined : definitions.get(ref);
		if (ref !== undefined) used.set(ref, inner);
		if (!ref || !inner || visiting.has(inner)) return false;
		let handles = nested.get(ref);
		if (!handles) {
			handles = fallbackHandleIds(inner, definitions, new Set([...visiting, definition]));
			nested.set(ref, handles);
		}
		return handles.has(handle);
	};
	return new Set(
		definition.edges
			.filter((e) => inputIds.has(e.source) && isFallback(e.target, e.targetHandle))
			.map((e) => e.sourceHandle),
	);
}
