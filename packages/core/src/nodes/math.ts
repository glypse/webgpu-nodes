import type { NodeDescriptor } from "../types";
import { FLOAT_TYPES, NUMERIC_TYPES, SIGNED_TYPES } from "../types";
import { binaryNode, nAryFn, unaryFn, variadicFn, variadicOp } from "./builders";

// Math — unary (float)
export const sinNode = unaryFn("sin", "Sine", "sin");
export const cosNode = unaryFn("cos", "Cosine", "cos");
export const tanNode = unaryFn("tan", "Tangent", "tan");
export const atanNode: NodeDescriptor = {
	...unaryFn("atan", "Arc Tangent", "atan"),
	aliases: ["atan", "Arctangent", "Inverse Tangent"],
};
export const floorNode: NodeDescriptor = {
	...unaryFn("floor", "Floor", "floor"),
	aliases: ["Round Down"],
};
export const ceilNode: NodeDescriptor = {
	...unaryFn("ceil", "Ceil", "ceil"),
	aliases: ["Ceiling", "Round Up"],
};
export const fractNode: NodeDescriptor = {
	...unaryFn("fract", "Fract", "fract"),
	aliases: ["Fraction", "Fractional Part"],
};
export const roundNode: NodeDescriptor = {
	...unaryFn("round", "Round", "round"),
	aliases: ["Nearest Integer", "rint"],
};
export const sqrtNode: NodeDescriptor = {
	...unaryFn("sqrt", "Square Root", "sqrt"),
	aliases: ["sqrt", "Root"],
};

// Math — unary (any number)
export const absNode: NodeDescriptor = {
	...unaryFn("abs", "Absolute", "abs", NUMERIC_TYPES),
	aliases: ["Vector Math"],
};
export const signNode: NodeDescriptor = {
	...unaryFn("sign", "Sign", "sign", SIGNED_TYPES),
	aliases: ["Signum", "sgn"],
};
export const negateNode: NodeDescriptor = {
	...unaryFn("negate", "Negate", "", SIGNED_TYPES),
	aliases: ["Negative", "Flip Sign"],
	wgsl: (ctx) => [`let ${ctx.varName} = -(${ctx.promoteInput("e")});`],
};

// Math — variadic
export const addNode: NodeDescriptor = {
	...variadicOp("add", "Add", " + "),
	aliases: ["Plus", "Sum", "Vector Math"],
};
export const mulNode: NodeDescriptor = {
	...variadicOp("mul", "Multiply", " * "),
	aliases: ["Times", "Product", "Scale", "Vector Math"],
};
export const minNode: NodeDescriptor = {
	...variadicFn("min", "Minimum", "min"),
	aliases: ["Darken", "Vector Math"],
};
export const maxNode: NodeDescriptor = {
	...variadicFn("max", "Maximum", "max"),
	aliases: ["Lighten", "Vector Math"],
};

// Math — binary
export const subNode: NodeDescriptor = {
	...binaryNode("sub", "Subtract", (a, b) => `${a} - ${b}`),
	aliases: ["Minus", "Difference", "Vector Math"],
};
export const divNode: NodeDescriptor = {
	...binaryNode(
		"div",
		"Divide",
		(a, b, ctx) => `${ctx.helper("safeDiv", ctx.outputType)}(${a}, ${b})`,
	),
	aliases: ["Quotient", "Vector Math"],
};
export const modNode: NodeDescriptor = {
	...binaryNode(
		"mod",
		"Modulo",
		(a, b, ctx) => `${ctx.helper("safeMod", ctx.outputType)}(${a}, ${b})`,
	),
	aliases: ["Remainder", "fmod", "Truncated Modulo", "Vector Math"],
};
export const powNode: NodeDescriptor = {
	...binaryNode(
		"pow",
		"Power",
		(a, b, ctx) => `${ctx.helper("safePow", ctx.outputType)}(${a}, ${b})`,
		{ types: FLOAT_TYPES, ids: ["e1", "e2"] },
	),
	aliases: ["Exponent", "Gamma"],
};
export const stepNode: NodeDescriptor = {
	...binaryNode("step", "Step", (a, b) => `step(${a}, ${b})`, {
		types: FLOAT_TYPES,
		ids: ["e1", "e2"],
		labels: ["edge", "x"],
	}),
	aliases: ["Threshold", "Greater Than", "Heaviside"],
};
export const atan2Node: NodeDescriptor = {
	...binaryNode("atan2", "Arc Tangent 2", (a, b) => `atan2(${a}, ${b})`, {
		types: FLOAT_TYPES,
		ids: ["e1", "e2"],
		labels: ["y", "x"],
	}),
	aliases: ["atan2", "Arctangent 2", "Angle"],
};

// Math — N-ary
export const clampNode: NodeDescriptor = {
	...nAryFn(
		"clamp",
		"Clamp",
		"clamp",
		[
			{ id: "e", label: "e", types: NUMERIC_TYPES },
			{ id: "low", label: "low", types: NUMERIC_TYPES },
			{ id: "high", label: "high", types: NUMERIC_TYPES },
		],
		{ e: 0, low: 0, high: 1 },
	),
	aliases: ["Saturate", "Limit", "Clip"],
};
export const mixNode: NodeDescriptor = {
	...nAryFn(
		"mix",
		"Mix",
		"mix",
		[
			{ id: "e1", label: "e1", types: FLOAT_TYPES },
			{ id: "e2", label: "e2", types: FLOAT_TYPES },
			{ id: "e3", label: "e3", types: FLOAT_TYPES },
		],
		{ e1: 0, e2: 0, e3: 0 },
	),
	aliases: ["Lerp", "Linear Interpolate", "Interpolate", "Blend", "Mix Color", "Cross Fade"],
};
export const smoothstepNode: NodeDescriptor = {
	...nAryFn(
		"smoothstep",
		"Smoothstep",
		"smoothstep",
		[
			{ id: "low", label: "low", types: FLOAT_TYPES },
			{ id: "high", label: "high", types: FLOAT_TYPES },
			{ id: "x", label: "x", types: FLOAT_TYPES },
		],
		{ low: 0, high: 1, x: 0 },
	),
	aliases: ["Smooth Step", "Hermite", "Ease", "Smooth Threshold"],
};
