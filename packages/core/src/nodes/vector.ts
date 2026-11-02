import {
	defineNode,
	FLOAT_VEC_TYPES,
	makeType,
	typeComponents,
	typeKind,
	VEC_TYPES,
	WGSL_TYPES,
	type WgslType,
} from "../types";
import { binaryNode, unaryFn } from "./builders";

/** Measurable as WGSL's `length` and `distance` measure them: a scalar as its absolute value. */
const MEASURED_TYPES: readonly WgslType[] = [...FLOAT_VEC_TYPES, "f32"];

export const COMPONENT_COUNT = "component-count";
export const COMPONENT_COUNT_INPUT = "value";

// Vector
export const dotNode = defineNode({
	...binaryNode("dot", "Dot Product", (a, b) => `dot(${a}, ${b})`, {
		types: FLOAT_VEC_TYPES,
		ids: ["e1", "e2"],
		category: "vector",
	}),
	aliases: ["Scalar Product", "Inner Product", "Vector Math"],
	resolveOutputType: () => "f32",
});
export const distanceNode = defineNode({
	...binaryNode("distance", "Distance", (a, b) => `distance(${a}, ${b})`, {
		types: MEASURED_TYPES,
		ids: ["e1", "e2"],
		category: "vector",
	}),
	aliases: ["Vector Math"],
	resolveOutputType: () => "f32",
});
export const lengthNode = defineNode({
	type: "length",
	label: "Length",
	aliases: ["Magnitude", "Norm", "Vector Math"],
	category: "vector",
	inputs: [{ id: "e1", label: "e1", types: MEASURED_TYPES }],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { values: { e1: 0 } },
	resolveOutputType: () => "f32",
	wgsl: (ctx) => [`let ${ctx.varName} = length(${ctx.promoteInput("e1")});`],
});
export const normalizeNode = defineNode({
	...unaryFn("normalize", "Normalize", "normalize", FLOAT_VEC_TYPES, "vector"),
	aliases: ["Normalise", "Unit Vector", "Vector Math"],
});
export const crossNode = defineNode({
	...binaryNode("cross", "Cross Product", (a, b) => `cross(${a}, ${b})`, {
		types: ["vec3f"],
		ids: ["e1", "e2"],
		category: "vector",
	}),
	aliases: ["Vector Product", "Vector Math"],
	resolveOutputType: () => "vec3f",
});
export const reflectNode = defineNode({
	...binaryNode("reflect", "Reflect", (a, b) => `reflect(${a}, ${b})`, {
		types: FLOAT_VEC_TYPES,
		ids: ["e1", "e2"],
		labels: ["incident", "normal"],
		category: "vector",
	}),
	aliases: ["Reflection", "Vector Math"],
});

/**
 * How many components its input's type has, known while compiling: an enum
 * a Match node or a group's enum input can branch on, so a group generic
 * over vector widths can take each width's path.
 */
export const componentCountNode = defineNode({
	type: COMPONENT_COUNT,
	label: "Component Count",
	aliases: ["Dimensions", "Vector Size", "Vector Width", "Length of Type"],
	category: "vector",
	inputs: [{ id: COMPONENT_COUNT_INPUT, label: "value", types: WGSL_TYPES }],
	outputs: [{ id: "count", label: "count", type: "u32" }],
	staticOutputTypes: true,
	defaultData: {},
	wgsl: (ctx) => {
		const type = ctx.inputTypes[COMPONENT_COUNT_INPUT] ?? "f32";
		return [`let ${ctx.varName} = ${String(typeComponents(type))}u;`];
	},
});

const SEPARATE_COMPONENTS = ["x", "y", "z", "w"] as const;

export const separateVectorNode = defineNode({
	type: "separate-vector",
	label: "Separate Vector",
	aliases: [
		"Separate XYZ",
		"Separate Color",
		"Separate RGB",
		"Split Vector",
		"Break Vector",
		"Break Out Float3 Components",
		"Component Mask",
		"Swizzle",
		"Shuffle",
	],
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
});
