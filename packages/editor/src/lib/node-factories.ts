import type { HydratedGraphDocument } from "./graph-types";
import type {
	GroupedNode,
	HandleDef,
	NodeDescriptor,
	NodeInputDef,
	WgslType,
	WgslCtx,
} from "./types";

// ── Input helpers ─────────────────────────────────────────────────────────────

/** Extract a single named input's upstream variable. Safe to call — codegen guarantees presence. */
function input(ctx: WgslCtx, name: string): string {
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by codegen
	return ctx.inputs[name]![0]!;
}

// ── Factory: unary math function (sin, cos, tan, abs) ────────────────────────

function unaryFn(type: string, label: string, wgslFn: string): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [{ id: "e", label: "e", type: "f32" }],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { e: 0 },
		wgsl: (ctx) => [`let ${ctx.varName} = ${wgslFn}(${input(ctx, "e")});`],
	};
}

// ── Factory: variadic join operator (add, mul) ───────────────────────────────

function variadicOp(type: string, label: string, joiner: string): NodeDescriptor {
	return {
		type,
		label,
		category: "math",
		inputs: [{ id: "operands", label: "operands", type: "f32", variadic: true }],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: {},
		wgsl: (ctx) => {
			const list = ctx.inputs.operands ?? [];
			if (list.length === 0) return [`let ${ctx.varName} = f32(0.0);`];
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
			{ id: "e1", label: "e1", type: "f32" },
			{ id: "e2", label: "e2", type: "f32" },
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { e1: 0, e2: 0 },
		wgsl: (ctx) => [
			`let ${ctx.varName} = ${wgslFn}(${input(ctx, "e1")}, ${input(ctx, "e2")});`,
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
			{ id: "a", label: "a", type: "f32" },
			{ id: "b", label: "b", type: "f32" },
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { a: 0, b: 0 },
		wgsl: (ctx) => [`let ${ctx.varName} = ${op(input(ctx, "a"), input(ctx, "b"))};`],
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
			const args = inputDefs.map((d) => input(ctx, d.id)).join(", ");
			return [`let ${ctx.varName} = ${wgslFn}(${args});`];
		},
	};
}

// ── Factory: vector constructor (vec2f, vec3f, vec4f) ────────────────────────

function vecConstructor(
	type: string,
	components: string[],
	defaults: Record<string, number>,
): NodeDescriptor {
	const outType = type as WgslType;
	return {
		type,
		label: type.charAt(0).toUpperCase() + type.slice(1),
		category: "vector",
		inputs: components.map((c) => ({ id: c, label: c, type: "f32" as const })),
		outputs: [{ id: "value", label: "value", type: outType }],
		defaultData: defaults,
		wgsl: (ctx) => {
			const args = components.map((c) => input(ctx, c)).join(", ");
			return [`let ${ctx.varName} = ${type}(${args});`];
		},
	};
}

// ── Factory: vector decompose (separateVec2f, separateVec3f, separateVec4f) ──

function separateVec(type: string, dim: number): NodeDescriptor {
	const components = ["x", "y", "z", "w"].slice(0, dim);
	const inputName = components.join("");
	const vecType = `vec${String(dim)}f` as WgslType;
	const vecDefault = `${vecType}(0.0)`;
	const label = `Separate Vec${String(dim)}f`;

	return {
		type,
		label,
		category: "vector",
		inputs: [{ id: inputName, label: inputName, type: vecType }],
		outputs: components.map((c) => ({ id: c, label: c, type: "f32" as const })),
		defaultData: Object.fromEntries(components.map((c) => [c, 0])),
		wgsl: (ctx) => {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const src = ctx.inputs[inputName]![0] ?? vecDefault;
			return components.map(
				(c) =>
					// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
					`let ${ctx.outputVars[c]} = ${src}.${c};`,
			);
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

// Math — binary operator
export const subNode = binaryOp("sub", "Subtract", (a, b) => `${a} - ${b}`);
export const divNode = binaryOp("div", "Divide", (a, b) => `safeDivF32(${a}, ${b})`);

// Math — N-ary function call
export const clampNode = nAryFn(
	"clamp",
	"Clamp",
	"clamp",
	[
		{ id: "e", label: "e", type: "f32" },
		{ id: "low", label: "low", type: "f32" },
		{ id: "high", label: "high", type: "f32" },
	],
	{ e: 0, low: 0, high: 1 },
);
export const mixNode = nAryFn(
	"mix",
	"Mix",
	"mix",
	[
		{ id: "e1", label: "e1", type: "f32" },
		{ id: "e2", label: "e2", type: "f32" },
		{ id: "e3", label: "e3", type: "f32" },
	],
	{ e1: 0, e2: 0, e3: 0 },
);

// Vector — constructors
export const vec2fNode = vecConstructor("vec2f", ["x", "y"], { x: 0, y: 0 });
export const vec3fNode = vecConstructor("vec3f", ["x", "y", "z"], { x: 0, y: 0, z: 0 });
export const vec4fNode = vecConstructor("vec4f", ["x", "y", "z", "w"], { x: 0, y: 0, z: 0, w: 1 });

// Vector — decompose
export const separateVec2fNode = separateVec("separateVec2f", 2);
export const separateVec3fNode = separateVec("separateVec3f", 3);
export const separateVec4fNode = separateVec("separateVec4f", 4);

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

export const floatNode: NodeDescriptor = {
	type: "float",
	label: "f32",
	category: "input",
	inputs: [{ id: "value", label: "value", type: "f32" }],
	outputs: [{ id: "value", label: "value", type: "f32" }],
	defaultData: { value: 0.0 },
	wgsl: ({ varName, data }) => [`let ${varName} = f32(${String(data.value)});`],
};

export const outputNode: NodeDescriptor = {
	type: "frag-output",
	label: "Output",
	category: "misc",
	inputs: [{ id: "color", label: "color", type: "vec4f" }],
	outputs: [],
	defaultData: {},
	wgsl: (ctx) => [`let ${ctx.varName} = ${input(ctx, "color")};`],
};

export const powNode: NodeDescriptor = {
	type: "pow",
	label: "Power",
	category: "math",
	inputs: [
		{ id: "e1", label: "e1", type: "f32" },
		{ id: "e2", label: "e2", type: "f32" },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e1: 0, e2: 0 },
	wgsl: (ctx) => {
		const e = input(ctx, "e1");
		const p = input(ctx, "e2");
		return [
			`var ${ctx.varName}: f32;`,
			`if (${p} == 0.0) {`,
			`  ${ctx.varName} = 1.0;`,
			`} else {`,
			`  ${ctx.varName} = pow(${e}, ${p});`,
			`}`,
		];
	},
};

export const remapNode: NodeDescriptor = {
	type: "remap",
	label: "Remap",
	category: "math",
	inputs: [
		{ id: "e", label: "e", type: "f32" },
		{ id: "in_min", label: "in_min", type: "f32" },
		{ id: "in_max", label: "in_max", type: "f32" },
		{ id: "out_min", label: "out_min", type: "f32" },
		{ id: "out_max", label: "out_max", type: "f32" },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	defaultData: { e: 0, in_min: 0, in_max: 1, out_min: 0, out_max: 1 },
	wgsl: (ctx) => {
		const e = input(ctx, "e");
		const inMin = input(ctx, "in_min");
		const inMax = input(ctx, "in_max");
		const outMin = input(ctx, "out_min");
		const outMax = input(ctx, "out_max");
		return [
			`let ${ctx.varName} = ${outMin} + (${e} - ${inMin}) * safeDivF32((${outMax} - ${outMin}), (${inMax} - ${inMin}));`,
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
		inputs: handles.map((h) => ({ id: h.id, label: h.label, type: h.type })),
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
		inputs: handles.inputs.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		outputs: handles.outputs.map((h) => ({ id: h.id, label: h.label, type: h.type })),
		defaultData: {},
		wgsl: () => [],
	};
}
