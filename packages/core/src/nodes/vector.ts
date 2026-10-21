import type { NodeDescriptor } from "../types";
import { FLOAT_VEC_TYPES, VEC_TYPES, makeType, typeComponents, typeKind } from "../types";
import { binaryNode, unaryFn } from "./builders";

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
	defaultData: { values: { e1: 0 } },
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
