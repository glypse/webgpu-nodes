import type {
	NodeCategory,
	NodeDescriptor,
	NodeInputDef,
	NodeSetting,
	WgslCtx,
	WgslType,
} from "../types";
import {
	settingValue,
	FLOAT_TYPES,
	NUMERIC_TYPES,
	WGSL_DEFAULTS,
	WGSL_TYPES,
	makeType,
	typeComponents,
	typeKind,
	wgslTypeName,
} from "../types";

// ── Factory: unary function (sin, abs, floor, ...) ───────────────────────────

export function unaryFn(
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
		defaultData: { values: { e: 0 } },
		wgsl: (ctx) => [`let ${ctx.varName} = ${wgslFn}(${ctx.promoteInput("e")});`],
	};
}

// ── Factory: variadic join operator (add, mul) ───────────────────────────────

export function variadicOp(type: string, label: string, joiner: string): NodeDescriptor {
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

export function variadicFn(type: string, label: string, wgslFn: string): NodeDescriptor {
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

export function binaryNode(
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
		defaultData: { values: { [idA]: 0, [idB]: 0 } },
		wgsl: (ctx) => [
			`let ${ctx.varName} = ${emit(ctx.promoteInput(idA), ctx.promoteInput(idB), ctx)};`,
		],
	};
}

// ── Factory: N-ary function call (clamp, mix) ────────────────────────────────

export function nAryFn(
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
		defaultData: { values: defaults },
		wgsl: (ctx) => {
			const args = inputDefs.map((d) => ctx.promoteInput(d.id)).join(", ");
			return [`let ${ctx.varName} = ${wgslFn}(${args});`];
		},
	};
}

// ── Factory: built-in uniform reader (time, delta, resolution, uv) ───────────

export function uniformReader(
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

export function convertNode(
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
		defaultData: {
			values: { e: 0 },
			...(rounding ? { settings: { rounding: "trunc" } } : {}),
		},
		settings: rounding ? [ROUNDING_SETTING] : undefined,
		resolveOutputType: (t) => makeType(kind, typeComponents(t)),
		wgsl: (ctx) => {
			const sourceType = ctx.inputTypes.e ?? "f32";
			let expr = ctx.promoteInput("e");
			if (rounding && typeKind(sourceType) === "f32") {
				const mode = settingValue(ctx.data, ROUNDING_SETTING);
				expr = `${mode}(${expr})`;
			}
			return [`let ${ctx.varName} = ${ctx.convert(expr, sourceType, ctx.outputType)};`];
		},
	};
}
