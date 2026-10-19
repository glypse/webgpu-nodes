import type { Node } from "@xyflow/svelte";

// ─── WGSL type system ────────────────────────────────────────
//
// Every value type is a (scalar kind × component count) pair: f32, vec3i,
// vec2b, ... Component count drives connection rules (a lower-N value can be
// promoted to fill a higher-N input, never the other way around), while the
// scalar kind is always implicitly convertible (Blender-like): int → float is
// exact, float → int truncates toward zero, number → bool is `!= 0` and
// bool → number is 0/1. See `convertVar`.

/** Scalar kinds, ordered from "narrowest" to "widest" (see `KIND_RANK`). */
export const SCALAR_KINDS = ["bool", "u32", "i32", "f32"] as const;
export type ScalarKind = (typeof SCALAR_KINDS)[number];

export const FLOAT_TYPES = ["f32", "vec2f", "vec3f", "vec4f"] as const;
export const INT_TYPES = ["i32", "vec2i", "vec3i", "vec4i"] as const;
export const UINT_TYPES = ["u32", "vec2u", "vec3u", "vec4u"] as const;
export const BOOL_TYPES = ["bool", "vec2b", "vec3b", "vec4b"] as const;

/** All concrete value types. f32 comes first: it is the default for untyped values. */
export const WGSL_TYPES = [...FLOAT_TYPES, ...INT_TYPES, ...UINT_TYPES, ...BOOL_TYPES] as const;

export type WgslType = (typeof WGSL_TYPES)[number];

/** Types supporting arithmetic. Float first so unconnected inputs default to f32. */
export const NUMERIC_TYPES: readonly WgslType[] = [...FLOAT_TYPES, ...INT_TYPES, ...UINT_TYPES];
/** Types supporting negation / sign. */
export const SIGNED_TYPES: readonly WgslType[] = [...FLOAT_TYPES, ...INT_TYPES];
/** Types supporting bitwise operators. */
export const INTEGER_TYPES: readonly WgslType[] = [...INT_TYPES, ...UINT_TYPES];
/** Single-component types. */
export const SCALAR_TYPES: readonly WgslType[] = ["f32", "i32", "u32", "bool"];
/** Float vectors (vec2f..vec4f). */
export const FLOAT_VEC_TYPES: readonly WgslType[] = ["vec2f", "vec3f", "vec4f"];

const TYPE_INFO: Record<WgslType, { kind: ScalarKind; components: 1 | 2 | 3 | 4 }> = {
	f32: { kind: "f32", components: 1 },
	vec2f: { kind: "f32", components: 2 },
	vec3f: { kind: "f32", components: 3 },
	vec4f: { kind: "f32", components: 4 },
	i32: { kind: "i32", components: 1 },
	vec2i: { kind: "i32", components: 2 },
	vec3i: { kind: "i32", components: 3 },
	vec4i: { kind: "i32", components: 4 },
	u32: { kind: "u32", components: 1 },
	vec2u: { kind: "u32", components: 2 },
	vec3u: { kind: "u32", components: 3 },
	vec4u: { kind: "u32", components: 4 },
	bool: { kind: "bool", components: 1 },
	vec2b: { kind: "bool", components: 2 },
	vec3b: { kind: "bool", components: 3 },
	vec4b: { kind: "bool", components: 4 },
};

/** Every vector type, all kinds. */
export const VEC_TYPES: readonly WgslType[] = WGSL_TYPES.filter((t) => typeComponents(t) > 1);

const KIND_SUFFIX: Record<ScalarKind, string> = { f32: "f", i32: "i", u32: "u", bool: "b" };

/** Ordering used to pick a common kind: float absorbs ints, ints absorb bools. */
const KIND_RANK: Record<ScalarKind, number> = { bool: 0, u32: 1, i32: 2, f32: 3 };

export function isWgslType(value: unknown): value is WgslType {
	return typeof value === "string" && value in TYPE_INFO;
}

export function typeKind(type: WgslType): ScalarKind {
	return TYPE_INFO[type].kind;
}

export function typeComponents(type: WgslType): 1 | 2 | 3 | 4 {
	return TYPE_INFO[type].components;
}

/** Component count per WGSL type, used to decide promotion direction. */
export const WGSL_COMPONENTS: Record<WgslType, number> = Object.fromEntries(
	WGSL_TYPES.map((t) => [t, TYPE_INFO[t].components]),
) as Record<WgslType, number>;

/** Build the type with the given kind and component count. */
export function makeType(kind: ScalarKind, components: number): WgslType {
	if (components <= 1) return kind;
	const n = Math.min(4, Math.round(components));
	return `vec${String(n)}${KIND_SUFFIX[kind]}` as WgslType;
}

/** The spelling of a type in WGSL source. Bool vectors have no predeclared alias. */
export function wgslTypeName(type: WgslType): string {
	const { kind, components } = TYPE_INFO[type];
	if (kind === "bool" && components > 1) return `vec${String(components)}<bool>`;
	return type;
}

/** Zero value of every type, e.g. `vec3f()` or `vec2<bool>()`. */
export const WGSL_DEFAULTS: Record<WgslType, string> = Object.fromEntries(
	WGSL_TYPES.map((t) => [t, `${wgslTypeName(t)}()`]),
) as Record<WgslType, string>;

/**
 * Whether a value of `source` type may be connected to an input of `target`
 * type. Scalar kinds always convert implicitly; component counts may only grow
 * (the user must decompose a vector to pick components).
 */
export function isConnectionCompatible(source: WgslType, target: WgslType): boolean {
	return typeComponents(source) <= typeComponents(target);
}

const SWIZZLE = ["x", "y", "z", "w"];

function zeroScalar(kind: ScalarKind): string {
	switch (kind) {
		case "f32":
			return "0.0";
		case "i32":
			return "0i";
		case "u32":
			return "0u";
		case "bool":
			return "false";
	}
}

/**
 * Emit a WGSL expression converting `expr` (of `source` type) so it can be
 * consumed where `target` is expected.
 *
 * - kind changes use WGSL conversion constructors (`i32(x)`, `vec3f(v)`, `bool(x)`),
 * - scalar → vecN splats (`vec3f(x)`),
 * - vecN → higher-M pads with zeros (`vec4f(v, 0.0, 0.0)`),
 * - vecN → lower-M truncates with a swizzle (only used internally - connections
 *   never narrow, see `isConnectionCompatible`).
 */
export function convertVar(expr: string, source: WgslType, target: WgslType): string {
	if (source === target) return expr;
	const from = TYPE_INFO[source];
	const to = TYPE_INFO[target];
	const targetName = wgslTypeName(target);

	if (from.components === 1) {
		const scalar = from.kind === to.kind ? expr : `${to.kind}(${expr})`;
		return to.components === 1 ? scalar : `${targetName}(${scalar})`;
	}

	if (from.components > to.components) {
		const narrowed = `${expr}.${SWIZZLE.slice(0, to.components).join("")}`;
		const narrowedType = makeType(from.kind, to.components);
		return convertVar(narrowed, narrowedType, target);
	}

	const sameWidth = makeType(to.kind, from.components);
	const converted = from.kind === to.kind ? expr : `${wgslTypeName(sameWidth)}(${expr})`;
	if (from.components === to.components) return converted;
	const fill = Array.from({ length: to.components - from.components }, () => zeroScalar(to.kind));
	return `${targetName}(${[converted, ...fill].join(", ")})`;
}

/** The smallest type able to hold both `a` and `b`: widest kind, most components. */
export function joinTypes(a: WgslType, b: WgslType): WgslType {
	const kind = KIND_RANK[typeKind(a)] >= KIND_RANK[typeKind(b)] ? typeKind(a) : typeKind(b);
	return makeType(kind, Math.max(typeComponents(a), typeComponents(b)));
}

/**
 * Fit a wanted type into a family of allowed types. Keeps the wanted kind when
 * the family supports it (falling back to the family's default kind otherwise),
 * then picks the smallest allowed width able to hold the wanted components.
 */
export function fitType(wanted: WgslType, allowed: readonly WgslType[]): WgslType {
	if (allowed.length === 0 || allowed.includes(wanted)) return wanted;
	const allowedKinds = new Set(allowed.map(typeKind));
	const fallbackKind = allowed[0] ? typeKind(allowed[0]) : "f32";
	const kind = allowedKinds.has(typeKind(wanted)) ? typeKind(wanted) : fallbackKind;
	const sameKind = allowed
		.filter((t) => typeKind(t) === kind)
		.toSorted((a, b) => typeComponents(a) - typeComponents(b));
	const wide = sameKind.find((t) => typeComponents(t) >= typeComponents(wanted));
	return wide ?? sameKind[sameKind.length - 1] ?? allowed[0] ?? wanted;
}

/**
 * Pick the type a family resolves to given its connected source types. With no
 * candidates, the family's default (first) type is used.
 */
export function highestType(candidates: WgslType[], allowed: readonly WgslType[]): WgslType {
	const fallback = allowed[0] ?? "f32";
	if (candidates.length === 0) return fallback;
	return fitType(candidates.reduce(joinTypes), allowed);
}

// ─── Handle / descriptor types ───────────────────────────────

export type HandleDef = {
	/** Stable, generated once, never changes — this is what edges/targetHandle reference. */
	id: string;
	/** User-facing, editable later, defaults to something like "Input 1". */
	label: string;
	/** The WGSL type this handle carries. */
	type: WgslType;
};

export type NodeInputDef = {
	/** Stable port identifier. Doubles as the SvelteFlow Handle id and the key edges reference. */
	id: string;
	label: string;
	/**
	 * The concrete WGSL types this input accepts. The first element is the
	 * default type used when nothing is connected and no user override is set.
	 *
	 * Inputs sharing the same `types` array are in the same "family" — they
	 * resolve to one concrete type across the whole node (node-wide resolution).
	 */
	types: readonly WgslType[];
	/**
	 * If true, every edge connected to this handle is collected.
	 * The descriptor's wgsl receives `inputs[id]` as an array of upstream vars.
	 * For non-variadic, it's always 0 or 1 elements.
	 */
	variadic?: boolean;
};

/** Default type for an input: the first type in its `types` array. */
export function inputDefaultType(input: NodeInputDef): WgslType {
	return input.types[0] ?? "f32";
}

/**
 * Stable string key for grouping inputs into families.
 * Two inputs are in the same family when their `types` arrays are equal.
 */
export function inputFamilyKey(input: NodeInputDef): string {
	return input.types.join(",");
}

export type NodeOutputDef = {
	/** Stable port identifier. Doubles as the SvelteFlow Handle id and the key edges reference. */
	id: string;
	label: string;
	type: WgslType;
};

/** A user-facing enum setting shown on the node (e.g. a comparison operator). */
export type NodeSetting = {
	/** Key in node data holding the selected value. */
	key: string;
	label: string;
	options: readonly { value: string; label: string }[];
};

/** Every node that's used by SvelteFlow */
export type GroupedNode = Node & {
	group?: {
		definitionRef: string;
		locked: boolean;
	};
};

export type NodeCategory =
	| "input"
	| "math"
	| "vector"
	| "logic"
	| "integer"
	| "converter"
	| "zone"
	| "color"
	| "misc";

/** Shader helper functions nodes may request through `WgslCtx.helper`. */
export type HelperName = "safeDiv" | "safeMod" | "safePow";

export type WgslCtx = {
	varName: string;
	/**
	 * Map from output port id to its WGSL variable name.
	 * For single-output nodes this always has one entry pointing at the same variable as `varName`.
	 * For multi-output nodes each entry has a unique suffix: `{ x: "v_id_x", y: "v_id_y" }`.
	 */
	outputVars: Record<string, string>;
	data: Record<string, unknown>;
	/**
	 * Map from input port id → WGSL expressions of the upstream node(s).
	 * For non-variadic inputs: always 0 or 1 elements (raw, unconverted).
	 * For variadic inputs: N elements (one per connected edge), pre-converted
	 * to the resolved input type.
	 */
	inputs: Record<string, string[]>;
	/**
	 * The node-wide resolved type for each input handle.
	 * All inputs in the same TypeFamily share the same resolved type.
	 */
	inputTypes: Record<string, WgslType>;
	/**
	 * The resolved output type for this node instance.
	 * Determined by the node's `resolveOutputType` callback.
	 */
	outputType: WgslType;
	/** The active outputs for this node instance (with their resolved types). */
	resolvedOutputs: NodeOutputDef[];
	/** The active inputs for this node instance. */
	resolvedInputs: NodeInputDef[];
	/**
	 * Return a WGSL expression for the given input handle, converted to its
	 * resolved type. For variadic inputs, joins the operands with ", ".
	 */
	promoteInput: (id: string) => string;
	/** Convert an expression between two types (see `convertVar`). */
	convert: (expr: string, source: WgslType, target: WgslType) => string;
	/** Request a shared helper function overload; returns its name. */
	helper: (name: HelperName, type: WgslType) => string;
};

export type NodeDescriptor = {
	type: string;
	label: string;
	category: NodeCategory;
	/** Hide from the "add node" menu (e.g. nodes created in pairs). */
	hidden?: boolean;
	inputs: NodeInputDef[];
	outputs: NodeOutputDef[];
	defaultData: Record<string, unknown>;
	/** Enum settings rendered on the node; their values live in node data. */
	settings?: NodeSetting[];
	/**
	 * The input whose family drives the node's "representative" type (passed to
	 * `resolveOutputType`/`resolveOutputs`, and shown in the type dropdown).
	 * Defaults to the first input.
	 */
	primaryInput?: string;
	/**
	 * When true, each output keeps the type declared in its `NodeOutputDef`
	 * (group boundaries, zones). Otherwise every output carries the node-wide
	 * resolved `outputType`.
	 */
	staticOutputTypes?: boolean;
	/**
	 * Resolve the output type from the representative input type.
	 * When omitted, defaults to identity.
	 */
	resolveOutputType?: (resolvedType: WgslType) => WgslType;
	/**
	 * Resolve the active outputs based on the representative input type.
	 * When omitted, defaults to the static `outputs` array.
	 */
	resolveOutputs?: (resolvedInputType: WgslType) => NodeOutputDef[];
	/**
	 * Resolve the active inputs based on the resolved output type.
	 * When omitted, defaults to the static `inputs` array.
	 */
	resolveInputs?: (resolvedOutputType: WgslType) => NodeInputDef[];
	/**
	 * Declare a type family for this node's output type selection.
	 * When present, the type dropdown shows these types (instead of the
	 * primary input's types), and the override is stored under `key` in node data.
	 */
	typeFamily?: { key: string; types: readonly WgslType[] };
	/** Emit WGSL line(s) that define `varName`.
	 *  Each returned string becomes one statement in the current scope.
	 *  The `let ` / `var ` prefix is the node's own choice. */
	wgsl: (ctx: WgslCtx) => string[];
};
