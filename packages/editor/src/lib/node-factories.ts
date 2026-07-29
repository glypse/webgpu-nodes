import type { HydratedGraphDocument } from "./graph-types";
import type { GroupedNode, HandleDef, NodeDescriptor, NodeInputDef, WgslType } from "./types";
import { WGSL_DEFAULTS, WGSL_TYPES, VEC_TYPES, WGSL_COMPONENTS } from "./types";
import { cwFnName } from "./wgsl-helpers";

// ── Factory: unary math function (sin, cos, tan, abs) ────────────────────────

function unaryFn(type: string, label: string, wgslFn: string): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [{ id: "e", label: "e", types: WGSL_TYPES }],
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
		inputs: [
			{
				id: "operands",
				label: "operands",
				types: WGSL_TYPES,
				variadic: true,
			},
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: {},
		wgsl: (ctx) => {
			const list = ctx.inputs.operands ?? [];
			if (list.length === 0)
				return [`let ${ctx.varName} = ${WGSL_DEFAULTS[ctx.outputType]};`];
			// Variadic operands are pre-promoted by codegen to the resolved type
			return [`let ${ctx.varName} = ${list.join(joiner)};`];
		},
	};
}

// ── Factory: binary function call (min, max) ─────────────────────────────────

function binaryFn(type: string, label: string, wgslFn: string): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [
			{ id: "e1", label: "e1", types: WGSL_TYPES },
			{ id: "e2", label: "e2", types: WGSL_TYPES },
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { e1: 0, e2: 0 },
		wgsl: (ctx) => [
			`let ${ctx.varName} = ${wgslFn}(${ctx.promoteInput("e1")}, ${ctx.promoteInput("e2")});`,
		],
	};
}

// ── Factory: binary operator (sub, div) ──────────────────────────────────────

function binaryOp(
	type: string,
	label: string,
	op: (a: string, b: string) => string,
): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [
			{ id: "a", label: "a", types: WGSL_TYPES },
			{ id: "b", label: "b", types: WGSL_TYPES },
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { a: 0, b: 0 },
		wgsl: (ctx) => [
			`let ${ctx.varName} = ${op(ctx.promoteInput("a"), ctx.promoteInput("b"))};`,
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

// ── Vector decompose (separate) ───────────────────────────────────────────────

const SEPARATE_COMPONENTS = ["x", "y", "z", "w"];

export const separateVectorNode: NodeDescriptor = {
	type: "separate-vector",
	label: "Separate Vector",
	category: "math",
	inputs: [{ id: "v", label: "v", types: VEC_TYPES }],
	outputs: SEPARATE_COMPONENTS.map((c) => ({ id: c, label: c, type: "f32" })),
	defaultData: {},
	resolveOutputType: () => "f32",
	resolveOutputs: (resolvedInputType) => {
		const dim = WGSL_COMPONENTS[resolvedInputType];
		return SEPARATE_COMPONENTS.slice(0, dim).map((c) => ({
			id: c,
			label: c,
			type: "f32" as const,
		}));
	},
	wgsl: (ctx) => {
		const src = ctx.promoteInput("v");
		return ctx.resolvedOutputs.map((o) => {
			const varName = ctx.outputVars[o.id] ?? o.id;
			return `let ${varName} = ${src}.${o.id};`;
		});
	},
};

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
		wgsl: ({ varName }) => [`let ${varName}: ${outputType} = ${wgslExpr};`],
	};
}

// ── Node definitions ─────────────────────────────────────────────────────────

// Math — unary
export const sinNode = unaryFn("sin", "Sine", "sin");
export const cosNode = unaryFn("cos", "Cosine", "cos");
export const tanNode = unaryFn("tan", "Tangeant", "tan");
export const absNode = unaryFn("abs", "Absolute", "abs");

// Math — variadic
export const addNode = variadicOp("add", "Add", " + ");
export const mulNode = variadicOp("mul", "Multiply", " * ");

// Math — binary function call
export const minNode = binaryFn("min", "Minimum", "min");
export const maxNode = binaryFn("max", "Maximum", "max");
export const stepNode = binaryFn("step", "Step", "step");

// Math — binary operator
export const subNode = binaryOp("sub", "Subtract", (a, b) => `${a} - ${b}`);
export const divNode: NodeDescriptor = {
	type: "div",
	label: "Divide",
	category: "math",
	inputs: [
		{ id: "a", label: "a", types: WGSL_TYPES },
		{ id: "b", label: "b", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { a: 0, b: 0 },
	wgsl: (ctx) => [
		`let ${ctx.varName} = ${cwFnName("safeDiv", ctx.outputType)}(${ctx.promoteInput("a")}, ${ctx.promoteInput("b")});`,
	],
};

// Math — N-ary function call
export const clampNode = nAryFn(
	"clamp",
	"Clamp",
	"clamp",
	[
		{ id: "e", label: "e", types: WGSL_TYPES },
		{ id: "low", label: "low", types: WGSL_TYPES },
		{ id: "high", label: "high", types: WGSL_TYPES },
	],
	{ e: 0, low: 0, high: 1 },
);
export const mixNode = nAryFn(
	"mix",
	"Mix",
	"mix",
	[
		{ id: "e1", label: "e1", types: WGSL_TYPES },
		{ id: "e2", label: "e2", types: WGSL_TYPES },
		{ id: "e3", label: "e3", types: WGSL_TYPES },
	],
	{ e1: 0, e2: 0, e3: 0 },
);

// Math — dot product: (vecN, vecN) -> f32
export const dotNode: NodeDescriptor = {
	type: "dot",
	label: "Dot Product",
	category: "math",
	inputs: [
		{ id: "e1", label: "e1", types: VEC_TYPES },
		{ id: "e2", label: "e2", types: VEC_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0 },
	resolveOutputType: () => "f32",
	wgsl: (ctx) => [
		`let ${ctx.varName} = dot(${ctx.promoteInput("e1")}, ${ctx.promoteInput("e2")});`,
	],
};

export const distanceNode: NodeDescriptor = {
	type: "distance",
	label: "Distance",
	category: "math",
	inputs: [
		{ id: "e1", label: "e1", types: VEC_TYPES },
		{ id: "e2", label: "e2", types: VEC_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0 },
	resolveOutputType: () => "f32",
	wgsl: (ctx) => [
		`let ${ctx.varName} = distance(${ctx.promoteInput("e1")}, ${ctx.promoteInput("e2")});`,
	],
};

export const lengthNode: NodeDescriptor = {
	type: "length",
	label: "Length",
	category: "math",
	inputs: [{ id: "e1", label: "e1", types: VEC_TYPES }],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0 },
	resolveOutputType: () => "f32",
	wgsl: (ctx) => [`let ${ctx.varName} = length(${ctx.promoteInput("e1")});`],
};

// Vector — declare (type family driven)
const DECLARE_COMPONENTS = ["x", "y", "z", "w"];

export const declareNode: NodeDescriptor = {
	type: "declare",
	label: "Declare",
	category: "input",
	inputs: DECLARE_COMPONENTS.map((c) => ({ id: c, label: c, types: ["f32" as const] })),
	outputs: [{ id: "value", label: "value", type: "f32" as const }],
	defaultData: Object.fromEntries(DECLARE_COMPONENTS.map((c) => [c, 0])),
	typeFamily: { key: "declare", types: WGSL_TYPES },
	resolveOutputs: () => [{ id: "value", label: "value", type: "f32" as const }],
	resolveInputs: (resolvedOutputType) => {
		const dim = WGSL_COMPONENTS[resolvedOutputType];
		return DECLARE_COMPONENTS.slice(0, dim).map((c) => ({
			id: c,
			label: c,
			types: ["f32" as const],
		}));
	},
	wgsl: (ctx) => {
		const args = ctx.resolvedInputs.map((i) => ctx.promoteInput(i.id)).join(", ");
		if (ctx.outputType === "f32") return [`let ${ctx.varName} = ${args};`];
		return [`let ${ctx.varName} = ${ctx.outputType}(${args});`];
	},
};

// Input — uniforms
export const timeNode = uniformReader("time", "Time", "time", "f32", "motiongpuFrame.time");
export const deltaNode = uniformReader("delta", "Delta", "delta", "f32", "motiongpuFrame.delta");
export const resolutionNode = uniformReader(
	"resolution",
	"Resolution",
	"resolution",
	"vec2f",
	"motiongpuFrame.resolution",
);
export const uvNode = uniformReader("uv", "UV", "uv", "vec2f", "uv");

// ── Standalone nodes (unique patterns) ───────────────────────────────────────

export const outputNode: NodeDescriptor = {
	type: "frag-output",
	label: "Output",
	category: "misc",
	inputs: [{ id: "color", label: "color", types: ["vec4f"] }],
	outputs: [],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = ${ctx.promoteInput("color")};`],
};

export const powNode: NodeDescriptor = {
	type: "pow",
	label: "Power",
	category: "math",
	inputs: [
		{ id: "e1", label: "e1", types: WGSL_TYPES },
		{ id: "e2", label: "e2", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0 },
	wgsl: (ctx) => [
		`let ${ctx.varName} = ${cwFnName("safePow", ctx.outputType)}(${ctx.promoteInput("e1")}, ${ctx.promoteInput("e2")});`,
	],
};

export const remapNode: NodeDescriptor = {
	type: "remap",
	label: "Remap",
	category: "math",
	inputs: [
		{ id: "e", label: "e", types: WGSL_TYPES },
		{ id: "in_min", label: "in_min", types: WGSL_TYPES },
		{ id: "in_max", label: "in_max", types: WGSL_TYPES },
		{ id: "out_min", label: "out_min", types: WGSL_TYPES },
		{ id: "out_max", label: "out_max", types: WGSL_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e: 0, in_min: 0, in_max: 1, out_min: 0, out_max: 1 },
	wgsl: (ctx) => {
		const e = ctx.promoteInput("e");
		const inMin = ctx.promoteInput("in_min");
		const inMax = ctx.promoteInput("in_max");
		const outMin = ctx.promoteInput("out_min");
		const outMax = ctx.promoteInput("out_max");
		return [
			`let ${ctx.varName} = ${outMin} + (${e} - ${inMin}) * ${cwFnName("safeDiv", ctx.outputType)}((${outMax} - ${outMin}), (${inMax} - ${inMin}));`,
		];
	},
};

// ── Group descriptor builders ─────────────────────────────────────────────────

export function buildGroupInputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-input",
		label: "Group Input",
		category: "input",
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
		inputs: handles.map((h) => ({
			id: h.id,
			label: h.label,
			types: [h.type],
		})),
		outputs: [],
		defaultData: { handles: [] },
		wgsl: () => {
			throw new Error("unreachable");
		},
	};
}

export function buildGroupDescriptor(
	node: GroupedNode,
	definitions: Record<string, HydratedGraphDocument>,
): NodeDescriptor {
	const definitionRef = node.group?.definitionRef;
	const definition = definitionRef ? definitions[definitionRef] : undefined;

	if (!definition || !definitionRef) {
		console.warn(
			`[graph] group node "${node.id}" references missing definition "${String(definitionRef)}"`,
		);
		return {
			type: "node-group",
			label: "⚠ Missing group",
			category: "misc",
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
		inputs: handles.inputs.map((h) => ({
			id: h.id,
			label: h.label,
			types: [h.type],
		})),
		outputs: handles.outputs.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: {},
		wgsl: () => [],
	};
}
