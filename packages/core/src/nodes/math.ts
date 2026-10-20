import type { NodeDescriptor } from "../types";
import { FLOAT_TYPES, NUMERIC_TYPES, SIGNED_TYPES } from "../types";
import { binaryNode, nAryFn, unaryFn, variadicFn, variadicOp } from "./builders";

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
