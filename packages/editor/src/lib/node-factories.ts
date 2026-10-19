import type { HydratedGraphDocument } from "./hydrated-document.svelte";
import type {
	GroupedNode,
	HandleDef,
	NodeCategory,
	NodeDescriptor,
	NodeInputDef,
	NodeSetting,
	WgslCtx,
	WgslType,
} from "./types";
import {
	BOOL_TYPES,
	FLOAT_TYPES,
	FLOAT_VEC_TYPES,
	INTEGER_TYPES,
	NUMERIC_TYPES,
	SIGNED_TYPES,
	UINT_TYPES,
	VEC_TYPES,
	WGSL_DEFAULTS,
	WGSL_TYPES,
	makeType,
	typeComponents,
	typeKind,
	wgslTypeName,
} from "./types";

/** Read an enum setting from node data, falling back to the first option. */
export function settingValue(ctx: WgslCtx, setting: NodeSetting): string {
	const value = ctx.data[setting.key];
	const match = setting.options.find((o) => o.value === value);
	return (match ?? setting.options[0])?.value ?? "";
}

// ── Factory: unary function (sin, abs, floor, ...) ───────────────────────────

function unaryFn(
	type: string,
	label: string,
	wgslFn: string,
	types: readonly WgslType[] = FLOAT_TYPES,
	category: NodeCategory = "math",
): NodeDescriptor {
	return {
		type,
		label,
		category,
		inputs: [{ id: "e", label: "e", types }],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { e: 0 },
		wgsl: (ctx) => [`let ${ctx.varName} = ${wgslFn}(${ctx.promoteInput("e")});`],
	};
}

// ── Factory: variadic join operator (add, mul) ───────────────────────────────

function variadicOp(type: string, label: string, joiner: string): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [{ id: "operands", label: "operands", types: NUMERIC_TYPES, variadic: true }],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: {},
		wgsl: (ctx) => {
			const list = ctx.inputs.operands ?? [];
			if (list.length === 0)
				return [`let ${ctx.varName} = ${WGSL_DEFAULTS[ctx.outputType]};`];
			// Variadic operands are pre-converted by codegen to the resolved type
			return [`let ${ctx.varName} = ${list.join(joiner)};`];
		},
	};
}

// ── Factory: variadic function call (min, max) ─────────────────────────────

function variadicFn(type: string, label: string, wgslFn: string): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [{ id: "operands", label: "operands", types: NUMERIC_TYPES, variadic: true }],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: {},
		wgsl: (ctx) => {
			const list = ctx.inputs.operands ?? [];
			if (list.length === 0)
				return [`let ${ctx.varName} = ${WGSL_DEFAULTS[ctx.outputType]};`];
			const nested = list.reduce((acc, cur) => `${wgslFn}(${acc}, ${cur})`);
			return [`let ${ctx.varName} = ${nested};`];
		},
	};
}

// ── Factory: binary node (sub, step, atan2, ...) ─────────────────────────────

function binaryNode(
	type: string,
	label: string,
	emit: (a: string, b: string, ctx: WgslCtx) => string,
	opts: {
		types?: readonly WgslType[];
		labels?: [string, string];
		ids?: [string, string];
		category?: NodeCategory;
	} = {},
): NodeDescriptor {
	const [idA, idB] = opts.ids ?? ["a", "b"];
	const [labelA, labelB] = opts.labels ?? [idA, idB];
	const types = opts.types ?? NUMERIC_TYPES;
	return {
		type,
		label,
		category: opts.category ?? "math",
		inputs: [
			{ id: idA, label: labelA, types },
			{ id: idB, label: labelB, types },
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { [idA]: 0, [idB]: 0 },
		wgsl: (ctx) => [
			`let ${ctx.varName} = ${emit(ctx.promoteInput(idA), ctx.promoteInput(idB), ctx)};`,
		],
	};
}

// ── Factory: N-ary function call (clamp, mix) ────────────────────────────────

function nAryFn(
	type: string,
	label: string,
	wgslFn: string,
	inputDefs: NodeInputDef[],
	defaults: Record<string, number>,
): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: inputDefs,
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: defaults,
		wgsl: (ctx) => {
			const args = inputDefs.map((d) => ctx.promoteInput(d.id)).join(", ");
			return [`let ${ctx.varName} = ${wgslFn}(${args});`];
		},
	};
}

// ── Factory: built-in uniform reader (time, delta, resolution, uv) ───────────

function uniformReader(
	type: string,
	label: string,
	outputName: string,
	outputType: WgslType,
	wgslExpr: string,
): NodeDescriptor {
	return {
		type,
		label,
		category: "input",
		inputs: [],
		outputs: [{ id: outputName, label: outputName, type: outputType }],
		defaultData: {},
		wgsl: ({ varName }) => [`let ${varName}: ${wgslTypeName(outputType)} = ${wgslExpr};`],
	};
}

// ── Factory: conversion to a scalar kind (To Float, To Integer, ...) ─────────

const ROUNDING_SETTING: NodeSetting = {
	key: "rounding",
	label: "Rounding",
	options: [
		{ value: "trunc", label: "Truncate" },
		{ value: "floor", label: "Floor" },
		{ value: "ceil", label: "Ceil" },
		{ value: "round", label: "Round" },
	],
};

function convertNode(
	type: string,
	label: string,
	kind: "f32" | "i32" | "u32" | "bool",
	rounding: boolean,
): NodeDescriptor {
	return {
		type,
		label,
		category: "converter",
		inputs: [{ id: "e", label: "e", types: WGSL_TYPES }],
		outputs: [{ id: "result", label: "result", type: kind }],
		defaultData: rounding ? { e: 0, rounding: "trunc" } : { e: 0 },
		settings: rounding ? [ROUNDING_SETTING] : undefined,
		resolveOutputType: (t) => makeType(kind, typeComponents(t)),
		wgsl: (ctx) => {
			const sourceType = ctx.inputTypes.e ?? "f32";
			let expr = ctx.promoteInput("e");
			if (rounding && typeKind(sourceType) === "f32") {
				const mode = settingValue(ctx, ROUNDING_SETTING);
				expr = `${mode}(${expr})`;
			}
			return [`let ${ctx.varName} = ${ctx.convert(expr, sourceType, ctx.outputType)};`];
		},
	};
}

// ── Node definitions ─────────────────────────────────────────────────────────

// Math — unary (float)
export const sinNode = unaryFn("sin", "Sine", "sin");
export const cosNode = unaryFn("cos", "Cosine", "cos");
export const tanNode = unaryFn("tan", "Tangent", "tan");
export const atanNode = unaryFn("atan", "Arc Tangent", "atan");
export const floorNode = unaryFn("floor", "Floor", "floor");
export const ceilNode = unaryFn("ceil", "Ceil", "ceil");
export const fractNode = unaryFn("fract", "Fract", "fract");
export const roundNode = unaryFn("round", "Round", "round");
export const sqrtNode = unaryFn("sqrt", "Square Root", "sqrt");

// Math — unary (any number)
export const absNode = unaryFn("abs", "Absolute", "abs", NUMERIC_TYPES);
export const signNode = unaryFn("sign", "Sign", "sign", SIGNED_TYPES);
export const negateNode: NodeDescriptor = {
	...unaryFn("negate", "Negate", "", SIGNED_TYPES),
	wgsl: (ctx) => [`let ${ctx.varName} = -(${ctx.promoteInput("e")});`],
};

// Math — variadic
export const addNode = variadicOp("add", "Add", " + ");
export const mulNode = variadicOp("mul", "Multiply", " * ");
export const minNode = variadicFn("min", "Minimum", "min");
export const maxNode = variadicFn("max", "Maximum", "max");

// Math — binary
export const subNode = binaryNode("sub", "Subtract", (a, b) => `${a} - ${b}`);
export const divNode = binaryNode(
	"div",
	"Divide",
	(a, b, ctx) => `${ctx.helper("safeDiv", ctx.outputType)}(${a}, ${b})`,
);
export const modNode = binaryNode(
	"mod",
	"Modulo",
	(a, b, ctx) => `${ctx.helper("safeMod", ctx.outputType)}(${a}, ${b})`,
);
export const powNode = binaryNode(
	"pow",
	"Power",
	(a, b, ctx) => `${ctx.helper("safePow", ctx.outputType)}(${a}, ${b})`,
	{ types: FLOAT_TYPES, ids: ["e1", "e2"] },
);
export const stepNode = binaryNode("step", "Step", (a, b) => `step(${a}, ${b})`, {
	types: FLOAT_TYPES,
	ids: ["e1", "e2"],
	labels: ["edge", "x"],
});
export const atan2Node = binaryNode("atan2", "Arc Tangent 2", (a, b) => `atan2(${a}, ${b})`, {
	types: FLOAT_TYPES,
	ids: ["e1", "e2"],
	labels: ["y", "x"],
});

// Math — N-ary
export const clampNode = nAryFn(
	"clamp",
	"Clamp",
	"clamp",
	[
		{ id: "e", label: "e", types: NUMERIC_TYPES },
		{ id: "low", label: "low", types: NUMERIC_TYPES },
		{ id: "high", label: "high", types: NUMERIC_TYPES },
	],
	{ e: 0, low: 0, high: 1 },
);
export const mixNode = nAryFn(
	"mix",
	"Mix",
	"mix",
	[
		{ id: "e1", label: "e1", types: FLOAT_TYPES },
		{ id: "e2", label: "e2", types: FLOAT_TYPES },
		{ id: "e3", label: "e3", types: FLOAT_TYPES },
	],
	{ e1: 0, e2: 0, e3: 0 },
);

export const remapNode: NodeDescriptor = {
	type: "remap",
	label: "Remap",
	category: "math",
	inputs: [
		{ id: "e", label: "e", types: FLOAT_TYPES },
		{ id: "in_min", label: "in_min", types: FLOAT_TYPES },
		{ id: "in_max", label: "in_max", types: FLOAT_TYPES },
		{ id: "out_min", label: "out_min", types: FLOAT_TYPES },
		{ id: "out_max", label: "out_max", types: FLOAT_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e: 0, in_min: 0, in_max: 1, out_min: 0, out_max: 1 },
	wgsl: (ctx) => {
		const e = ctx.promoteInput("e");
		const inMin = ctx.promoteInput("in_min");
		const inMax = ctx.promoteInput("in_max");
		const outMin = ctx.promoteInput("out_min");
		const outMax = ctx.promoteInput("out_max");
		const safeDiv = ctx.helper("safeDiv", ctx.outputType);
		return [
			`let ${ctx.varName} = ${outMin} + (${e} - ${inMin}) * ${safeDiv}((${outMax} - ${outMin}), (${inMax} - ${inMin}));`,
		];
	},
};

// Vector
export const dotNode: NodeDescriptor = {
	...binaryNode("dot", "Dot Product", (a, b) => `dot(${a}, ${b})`, {
		types: FLOAT_VEC_TYPES,
		ids: ["e1", "e2"],
		category: "vector",
	}),
	resolveOutputType: () => "f32",
};
export const distanceNode: NodeDescriptor = {
	...binaryNode("distance", "Distance", (a, b) => `distance(${a}, ${b})`, {
		types: FLOAT_VEC_TYPES,
		ids: ["e1", "e2"],
		category: "vector",
	}),
	resolveOutputType: () => "f32",
};
export const lengthNode: NodeDescriptor = {
	type: "length",
	label: "Length",
	category: "vector",
	inputs: [{ id: "e1", label: "e1", types: FLOAT_VEC_TYPES }],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0 },
	resolveOutputType: () => "f32",
	wgsl: (ctx) => [`let ${ctx.varName} = length(${ctx.promoteInput("e1")});`],
};
export const normalizeNode = unaryFn(
	"normalize",
	"Normalize",
	"normalize",
	FLOAT_VEC_TYPES,
	"vector",
);
export const crossNode: NodeDescriptor = {
	...binaryNode("cross", "Cross Product", (a, b) => `cross(${a}, ${b})`, {
		types: ["vec3f"],
		ids: ["e1", "e2"],
		category: "vector",
	}),
	resolveOutputType: () => "vec3f",
};
export const reflectNode = binaryNode("reflect", "Reflect", (a, b) => `reflect(${a}, ${b})`, {
	types: FLOAT_VEC_TYPES,
	ids: ["e1", "e2"],
	labels: ["incident", "normal"],
	category: "vector",
});

const SEPARATE_COMPONENTS = ["x", "y", "z", "w"];

export const separateVectorNode: NodeDescriptor = {
	type: "separate-vector",
	label: "Separate Vector",
	category: "vector",
	inputs: [{ id: "v", label: "v", types: VEC_TYPES }],
	outputs: SEPARATE_COMPONENTS.map((c) => ({ id: c, label: c, type: "f32" })),
	defaultData: {},
	resolveOutputType: (t) => makeType(typeKind(t), 1),
	resolveOutputs: (resolvedInputType) =>
		SEPARATE_COMPONENTS.slice(0, typeComponents(resolvedInputType)).map((c) => ({
			id: c,
			label: c,
			type: makeType(typeKind(resolvedInputType), 1),
		})),
	wgsl: (ctx) => {
		const src = ctx.promoteInput("v");
		return ctx.resolvedOutputs.map((o) => {
			const varName = ctx.outputVars[o.id] ?? o.id;
			return `let ${varName} = ${src}.${o.id};`;
		});
	},
};

// Input — declare (type family driven)
const DECLARE_COMPONENTS = ["x", "y", "z", "w"];

export const declareNode: NodeDescriptor = {
	type: "declare",
	label: "Declare",
	category: "input",
	inputs: DECLARE_COMPONENTS.map((c) => ({ id: c, label: c, types: ["f32"] as const })),
	outputs: [{ id: "value", label: "value", type: "f32" }],
	defaultData: Object.fromEntries(DECLARE_COMPONENTS.map((c) => [c, 0])),
	typeFamily: { key: "declare", types: WGSL_TYPES },
	resolveInputs: (resolvedOutputType) => {
		const scalar = makeType(typeKind(resolvedOutputType), 1);
		return DECLARE_COMPONENTS.slice(0, typeComponents(resolvedOutputType)).map((c) => ({
			id: c,
			label: c,
			types: [scalar],
		}));
	},
	wgsl: (ctx) => {
		const args = ctx.resolvedInputs.map((i) => ctx.promoteInput(i.id)).join(", ");
		if (typeComponents(ctx.outputType) === 1) return [`let ${ctx.varName} = ${args};`];
		return [`let ${ctx.varName} = ${wgslTypeName(ctx.outputType)}(${args});`];
	},
};

// Input — uniforms
export const timeNode = uniformReader("time", "Time", "time", "f32", "spektralFrame.time");
export const deltaNode = uniformReader("delta", "Delta", "delta", "f32", "spektralFrame.delta");
export const resolutionNode = uniformReader(
	"resolution",
	"Resolution",
	"resolution",
	"vec2f",
	"spektralFrame.resolution",
);
export const uvNode = uniformReader("uv", "UV", "uv", "vec2f", "uv");

// Logic
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
		const op = settingValue(ctx, COMPARE_SETTING);
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
			const emit = BOOLEAN_MATH_EXPR[settingValue(ctx, BOOLEAN_MATH_SETTING)];
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
		`let ${ctx.varName} = ${settingValue(ctx, REDUCE_SETTING)}(${ctx.promoteInput("e")});`,
	],
};

// Integer
const BITWISE_SETTING: NodeSetting = {
	key: "op",
	label: "Operation",
	options: [
		{ value: "&", label: "And" },
		{ value: "|", label: "Or" },
		{ value: "^", label: "Xor" },
	],
};

export const bitwiseNode: NodeDescriptor = {
	...binaryNode(
		"bitwise",
		"Bitwise",
		(a, b, ctx) => `${a} ${settingValue(ctx, BITWISE_SETTING)} ${b}`,
		{ types: INTEGER_TYPES, category: "integer" },
	),
	defaultData: { a: 0, b: 0, op: "&" },
	settings: [BITWISE_SETTING],
};

export const bitwiseNotNode: NodeDescriptor = {
	...unaryFn("bitwise-not", "Bitwise Not", "", INTEGER_TYPES, "integer"),
	wgsl: (ctx) => [`let ${ctx.varName} = ~(${ctx.promoteInput("e")});`],
};

const SHIFT_SETTING: NodeSetting = {
	key: "op",
	label: "Direction",
	options: [
		{ value: "<<", label: "Left" },
		{ value: ">>", label: "Right" },
	],
};

export const bitShiftNode: NodeDescriptor = {
	type: "bit-shift",
	label: "Bit Shift",
	category: "integer",
	inputs: [
		{ id: "a", label: "value", types: INTEGER_TYPES },
		{ id: "b", label: "shift", types: UINT_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "i32" }],
	defaultData: { a: 0, b: 0, op: "<<" },
	settings: [SHIFT_SETTING],
	wgsl: (ctx) => {
		// WGSL wants the shift amount as u32 (or a u32 vector of the value's
		// width), strictly below the bit width: mask it so constants stay valid.
		const shiftType = makeType("u32", typeComponents(ctx.outputType));
		const amount = ctx.convert(ctx.promoteInput("b"), ctx.inputTypes.b ?? "u32", shiftType);
		const mask = typeComponents(shiftType) === 1 ? "31u" : `${shiftType}(31u)`;
		const op = settingValue(ctx, SHIFT_SETTING);
		return [`let ${ctx.varName} = ${ctx.promoteInput("a")} ${op} (${amount} & ${mask});`];
	},
};

// Converters
export const toFloatNode = convertNode("to-float", "To Float", "f32", false);
export const toIntNode = convertNode("to-int", "To Integer", "i32", true);
export const toUintNode = convertNode("to-uint", "To Unsigned", "u32", true);
export const toBoolNode = convertNode("to-bool", "To Boolean", "bool", false);

// ── Standalone nodes (unique patterns) ───────────────────────────────────────

export const outputNode: NodeDescriptor = {
	type: "frag-output",
	label: "Output",
	category: "misc",
	hidden: true,
	inputs: [{ id: "color", label: "color", types: ["vec4f"] }],
	outputs: [],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("color")};`],
};

// ── Test nodes (for error handling UI testing) ────────────────────────────────

export const testInvalidWgslNode: NodeDescriptor = {
	type: "test-invalid-wgsl",
	label: "⚠ Test: Bad WGSL",
	category: "misc",
	inputs: [],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = this_is_not_valid_wgsl;`],
};

export const testRuntimeErrorNode: NodeDescriptor = {
	type: "test-runtime-error",
	label: "⚠ Test: Runtime Error",
	category: "misc",
	inputs: [{ id: "e", label: "e", types: FLOAT_TYPES }],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e: 0 },
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("e")} / f32(0.0);`],
};

// ── Group descriptor builders ─────────────────────────────────────────────────

export function buildGroupInputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-input",
		label: "Group Input",
		category: "input",
		hidden: true,
		staticOutputTypes: true,
		inputs: [],
		outputs: handles.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

export function buildGroupOutputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-output",
		label: "Group Output",
		category: "misc",
		hidden: true,
		inputs: handles.map((h) => ({ id: h.id, label: h.label, types: [h.type] })),
		outputs: [],
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

export function buildGroupDescriptor(
	node: GroupedNode,
	definitions: Map<string, HydratedGraphDocument>,
): NodeDescriptor {
	const definitionRef = node.group?.definitionRef;
	const definition = definitionRef ? definitions.get(definitionRef) : undefined;

	if (!definition || !definitionRef) {
		console.warn(
			`[graph] group node "${node.id}" references missing definition "${String(definitionRef)}"`,
		);
		return {
			type: "node-group",
			label: "⚠ Missing group",
			category: "misc",
			staticOutputTypes: true,
			inputs: [],
			outputs: [],
			defaultData: {},
			wgsl: () => [],
		};
	}

	const inputNode = definition.nodes.find((n) => n.type === "group-input");
	const outputNode = definition.nodes.find((n) => n.type === "group-output");

	const handles = {
		inputs: (inputNode?.data.handles ?? []) as HandleDef[],
		outputs: (outputNode?.data.handles ?? []) as HandleDef[],
	};

	return {
		type: "node-group",
		label: definition.label ?? definitionRef,
		category: "misc",
		staticOutputTypes: true,
		inputs: handles.inputs.map((h) => ({ id: h.id, label: h.label, types: [h.type] })),
		outputs: handles.outputs.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: {},
		wgsl: () => [],
	};
}
