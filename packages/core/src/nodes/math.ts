import { defineNode, FLOAT_TYPES, NUMERIC_TYPES, SIGNED_TYPES } from "../types";
import { binaryNode, nAryFn, unaryFn, variadicFn, variadicOp } from "./builders";
import { binaryCpu, naryCpu, roundHalfEven, unaryCpu, variadicCpu } from "./cpu";

// Math — unary (float)
export const sinNode = defineNode({ ...unaryFn("sin", "Sine", "sin"), cpu: unaryCpu(Math.sin) });
export const cosNode = defineNode({ ...unaryFn("cos", "Cosine", "cos"), cpu: unaryCpu(Math.cos) });
export const tanNode = defineNode({ ...unaryFn("tan", "Tangent", "tan"), cpu: unaryCpu(Math.tan) });
export const atanNode = defineNode({
	...unaryFn("atan", "Arc Tangent", "atan"),
	cpu: unaryCpu(Math.atan),
	aliases: ["atan", "Arctangent", "Inverse Tangent"],
});
export const floorNode = defineNode({
	...unaryFn("floor", "Floor", "floor"),
	cpu: unaryCpu(Math.floor),
	aliases: ["Round Down"],
});
export const ceilNode = defineNode({
	...unaryFn("ceil", "Ceil", "ceil"),
	cpu: unaryCpu(Math.ceil),
	aliases: ["Ceiling", "Round Up"],
});
export const fractNode = defineNode({
	...unaryFn("fract", "Fract", "fract"),
	cpu: unaryCpu((n) => n - Math.floor(n)),
	aliases: ["Fraction", "Fractional Part"],
});
export const roundNode = defineNode({
	...unaryFn("round", "Round", "round"),
	cpu: unaryCpu(roundHalfEven),
	aliases: ["Nearest Integer", "rint"],
});
export const sqrtNode = defineNode({
	...unaryFn("sqrt", "Square Root", "sqrt"),
	cpu: unaryCpu(Math.sqrt),
	aliases: ["sqrt", "Root"],
});
export const logNode = defineNode({
	...unaryFn("log", "Logarithm", "log"),
	cpu: unaryCpu(Math.log),
	aliases: ["ln", "Natural Logarithm", "log"],
});
export const expNode = defineNode({
	...unaryFn("exp", "Exponential", "exp"),
	cpu: unaryCpu(Math.exp),
	aliases: ["exp", "e^x", "Natural Exponent"],
});

// Math — unary (any number)
export const absNode = defineNode({
	...unaryFn("abs", "Absolute", "abs", NUMERIC_TYPES),
	cpu: unaryCpu(Math.abs),
	aliases: ["Vector Math"],
});
export const signNode = defineNode({
	...unaryFn("sign", "Sign", "sign", SIGNED_TYPES),
	cpu: unaryCpu(Math.sign),
	aliases: ["Signum", "sgn"],
});
export const negateNode = defineNode({
	...unaryFn("negate", "Negate", "", SIGNED_TYPES),
	cpu: unaryCpu((n) => -n),
	aliases: ["Negative", "Flip Sign"],
	wgsl: (ctx) => [`let ${ctx.varName} = -(${ctx.promoteInput("e")});`],
});

// Math — variadic
export const addNode = defineNode({
	...variadicOp("add", "Add", " + "),
	cpu: variadicCpu((a, b) => a + b),
	aliases: ["Plus", "Sum", "Vector Math"],
});
export const mulNode = defineNode({
	...variadicOp("mul", "Multiply", " * "),
	cpu: variadicCpu((a, b) => a * b, Math.imul),
	aliases: ["Times", "Product", "Scale", "Vector Math"],
});
export const minNode = defineNode({
	...variadicFn("min", "Minimum", "min"),
	cpu: variadicCpu(Math.min),
	aliases: ["Darken", "Vector Math"],
});
export const maxNode = defineNode({
	...variadicFn("max", "Maximum", "max"),
	cpu: variadicCpu(Math.max),
	aliases: ["Lighten", "Vector Math"],
});

// Math — binary
export const subNode = defineNode({
	...binaryNode("sub", "Subtract", (a, b) => `${a} - ${b}`),
	cpu: binaryCpu("a", "b", (a, b) => a - b),
	aliases: ["Minus", "Difference", "Vector Math"],
});
export const divNode = defineNode({
	...binaryNode(
		"div",
		"Divide",
		(a, b, ctx) => `${ctx.helper("safeDiv", ctx.outputType)}(${a}, ${b})`,
	),
	cpu: binaryCpu("a", "b", (a, b) => (b === 0 ? 0 : a / b)),
	aliases: ["Quotient", "Vector Math"],
});
export const modNode = defineNode({
	...binaryNode(
		"mod",
		"Modulo",
		(a, b, ctx) => `${ctx.helper("safeMod", ctx.outputType)}(${a}, ${b})`,
	),
	cpu: binaryCpu("a", "b", (a, b) => (b === 0 ? 0 : a % b)),
	aliases: ["Remainder", "fmod", "Truncated Modulo", "Vector Math"],
});
export const powNode = defineNode({
	...binaryNode(
		"pow",
		"Power",
		(a, b, ctx) => `${ctx.helper("safePow", ctx.outputType)}(${a}, ${b})`,
		{ types: FLOAT_TYPES, ids: ["e1", "e2"] },
	),
	cpu: binaryCpu("e1", "e2", (a, b) => (b === 0 ? 1 : a ** b)),
	aliases: ["Exponent", "Gamma"],
});
export const stepNode = defineNode({
	...binaryNode("step", "Step", (a, b) => `step(${a}, ${b})`, {
		types: FLOAT_TYPES,
		ids: ["e1", "e2"],
		labels: ["edge", "x"],
	}),
	cpu: binaryCpu("e1", "e2", (edge, x) => Number(x >= edge)),
	aliases: ["Threshold", "Greater Than", "Heaviside"],
});
export const atan2Node = defineNode({
	...binaryNode("atan2", "Arc Tangent 2", (a, b) => `atan2(${a}, ${b})`, {
		types: FLOAT_TYPES,
		ids: ["e1", "e2"],
		labels: ["y", "x"],
	}),
	cpu: binaryCpu("e1", "e2", Math.atan2),
	aliases: ["atan2", "Arctangent 2", "Angle"],
});

// Math — N-ary
export const clampNode = defineNode({
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
	cpu: naryCpu(["e", "low", "high"], (e, lo, hi) => Math.min(hi, Math.max(lo, e))),
	aliases: ["Saturate", "Limit", "Clip"],
});
export const mixNode = defineNode({
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
	cpu: naryCpu(["e1", "e2", "e3"], (a, b, t) => a * (1 - t) + b * t),
	aliases: ["Lerp", "Linear Interpolate", "Interpolate", "Blend", "Mix Color", "Cross Fade"],
});
export const smoothstepNode = defineNode({
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
	cpu: naryCpu(["low", "high", "x"], (low, high, x) => {
		const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
		return t * t * (3 - 2 * t);
	}),
	aliases: ["Smooth Step", "Hermite", "Ease", "Smooth Threshold"],
});
