import { type NodeDescriptor, type NodeSetting, settingValue } from "../types";
import { BOOL_TYPES, NUMERIC_TYPES, WGSL_TYPES, makeType, typeComponents } from "../types";
import { binaryNode, unaryFn } from "./builders";

const COMPARE_SETTING: NodeSetting = {
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
};

export const compareNode: NodeDescriptor = {
	type: "compare",
	label: "Compare",
	category: "logic",
	inputs: [
		{ id: "a", label: "a", types: NUMERIC_TYPES },
		{ id: "b", label: "b", types: NUMERIC_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "bool" }],
	defaultData: { a: 0, b: 0, op: "<" },
	settings: [COMPARE_SETTING],
	resolveOutputType: (t) => makeType("bool", typeComponents(t)),
	wgsl: (ctx) => {
		const op = settingValue(ctx.data, COMPARE_SETTING);
		return [`let ${ctx.varName} = ${ctx.promoteInput("a")} ${op} ${ctx.promoteInput("b")};`];
	},
};

export const switchNode: NodeDescriptor = {
	type: "switch",
	label: "Switch",
	category: "logic",
	primaryInput: "false",
	inputs: [
		{ id: "condition", label: "condition", types: BOOL_TYPES },
		{ id: "false", label: "false", types: WGSL_TYPES },
		{ id: "true", label: "true", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { condition: false, false: 0, true: 1 },
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
};

const BOOLEAN_MATH_SETTING: NodeSetting = {
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
};

const BOOLEAN_MATH_EXPR: Record<string, (a: string, b: string) => string> = {
	and: (a, b) => `${a} & ${b}`,
	or: (a, b) => `${a} | ${b}`,
	xor: (a, b) => `${a} != ${b}`,
	nand: (a, b) => `!(${a} & ${b})`,
	nor: (a, b) => `!(${a} | ${b})`,
	xnor: (a, b) => `${a} == ${b}`,
};

export const booleanMathNode: NodeDescriptor = {
	...binaryNode(
		"boolean-math",
		"Boolean Math",
		(a, b, ctx) => {
			const emit = BOOLEAN_MATH_EXPR[settingValue(ctx.data, BOOLEAN_MATH_SETTING)];
			return emit ? emit(a, b) : `${a} & ${b}`;
		},
		{ types: BOOL_TYPES, category: "logic" },
	),
	defaultData: { a: false, b: false, op: "and" },
	settings: [BOOLEAN_MATH_SETTING],
};

export const notNode: NodeDescriptor = {
	...unaryFn("not", "Not", "", BOOL_TYPES, "logic"),
	defaultData: { e: false },
	wgsl: (ctx) => [`let ${ctx.varName} = !(${ctx.promoteInput("e")});`],
};

const REDUCE_SETTING: NodeSetting = {
	key: "op",
	label: "Operation",
	options: [
		{ value: "any", label: "Any" },
		{ value: "all", label: "All" },
	],
};

export const reduceBooleanNode: NodeDescriptor = {
	...unaryFn("reduce-boolean", "Any / All", "", BOOL_TYPES, "logic"),
	defaultData: { e: false, op: "any" },
	settings: [REDUCE_SETTING],
	resolveOutputType: () => "bool",
	wgsl: (ctx) => [
		`let ${ctx.varName} = ${settingValue(ctx.data, REDUCE_SETTING)}(${ctx.promoteInput("e")});`,
	],
};

/**
 * Use `value` if it carries one, `default` otherwise. Presence is known while
 * compiling (it's never a runtime "null"): `value` is absent when nothing
 * feeds it, or when it comes from a group input whose socket the calling
 * group node left unlinked. Only the chosen branch is used, so a group can
 * compute its own default (e.g. the fragment's UV) for an unlinked input.
 */
export const fallbackNode: NodeDescriptor = {
	type: "fallback",
	label: "Fallback",
	category: "logic",
	inputs: [
		{ id: "value", label: "value", types: WGSL_TYPES },
		{ id: "default", label: "default", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { default: 0 },
	wgsl: (ctx) => {
		const chosen = ctx.isPresent("value") ? "value" : "default";
		return [`let ${ctx.varName} = ${ctx.promoteInput(chosen)};`];
	},
};

/**
 * Group-input handles of a definition whose value goes straight into a
 * Fallback node: unlinked on a group node, they fall back to the group's
 * own default instead of showing an editor.
 */
export function fallbackHandleIds(definition: {
	nodes: readonly { id: string; type?: string }[];
	edges: readonly {
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle: string;
	}[];
}): Set<string> {
	const inputIds = new Set(
		definition.nodes.filter((n) => n.type === "group-input").map((n) => n.id),
	);
	const fallbackIds = new Set(
		definition.nodes.filter((n) => n.type === "fallback").map((n) => n.id),
	);
	return new Set(
		definition.edges
			.filter(
				(e) =>
					inputIds.has(e.source) &&
					fallbackIds.has(e.target) &&
					e.targetHandle === "value",
			)
			.map((e) => e.sourceHandle),
	);
}
