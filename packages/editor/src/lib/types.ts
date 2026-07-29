import type { Node } from "@xyflow/svelte";

// ─── WGSL type system ────────────────────────────────────────

/** Single-component scalar types. */
export const SCALAR_TYPES = ["f32"] as const;

/** Vector types (all vecN<f32>). */
export const VEC_TYPES = ["vec2f", "vec3f", "vec4f"] as const;

/** All concrete WGSL types, derived from the two families above. */
export const WGSL_TYPES = [...SCALAR_TYPES, ...VEC_TYPES] as const;

export type WgslType = (typeof WGSL_TYPES)[number];

export const WGSL_DEFAULTS: Record<WgslType, string> = {
	f32: "f32(0.0)",
	vec2f: "vec2f(0.0, 0.0)",
	vec3f: "vec3f(0.0, 0.0, 0.0)",
	vec4f: "vec4f(0.0, 0.0, 0.0, 0.0)",
};

/** Component count per WGSL type, used to decide promotion direction. */
export const WGSL_COMPONENTS: Record<WgslType, number> = {
	f32: 1,
	vec2f: 2,
	vec3f: 3,
	vec4f: 4,
};

/**
 * Whether a value of `source` type may be connected to / fed into an input of
 * `target` type. Connections are allowed when the source has equal or fewer
 * components than the target (the lower-N value gets promoted to fill the
 * higher-N slots). Higher-to-lower connections are rejected: the user must
 * decompose the vector first (e.g. via a "Separate Vec" node) and pick the
 * component they want.
 */
export function isConnectionCompatible(source: WgslType, target: WgslType): boolean {
	return WGSL_COMPONENTS[source] <= WGSL_COMPONENTS[target];
}

/**
 * Emit a WGSL expression that promotes a variable of `source` type so it can be
 * consumed where `target` type is expected.
 *
 * - f32 -> vecNf: fills every slot with the scalar (`vec3f(v, v, v)`).
 * - vecNf -> higher-M vecMf: keeps the M available components and fills the
 *   remaining slots with 0 (`vec4f(v.xy, 0.0, 0.0)` for vec2f -> vec4f).
 * - equal types (or already matching): returned verbatim.
 *
 * When the value is already at-or-above the target size, `sourceVar` is returned
 * unchanged (callers only invoke this after `isConnectionCompatible`).
 */
export function promoteVar(sourceVar: string, source: WgslType, target: WgslType): string {
	if (source === target) return sourceVar;

	if (source === "f32") {
		switch (target) {
			case "vec2f":
				return `vec2f(${sourceVar}, ${sourceVar})`;
			case "vec3f":
				return `vec3f(${sourceVar}, ${sourceVar}, ${sourceVar})`;
			case "vec4f":
				return `vec4f(${sourceVar}, ${sourceVar}, ${sourceVar}, ${sourceVar})`;
		}
	}

	// vecNf -> higher-M vecMf
	const swizzle = ["x", "y", "z", "w"].slice(0, WGSL_COMPONENTS[source]).join("");
	const extra = WGSL_COMPONENTS[target] - WGSL_COMPONENTS[source];
	const fill = Array.from({ length: extra }, () => "0.0").join(", ");
	const args = `${sourceVar}.${swizzle}${fill ? `, ${fill}` : ""}`;
	return `${target}(${args})`;
}

/**
 * Pick the highest-N concrete type from a list of candidates and a fallback.
 * The fallback is always considered alongside the candidates, so the result
 * is never lower than either the best candidate or the fallback.
 */
export function highestType(candidates: WgslType[], fallback: WgslType = "f32"): WgslType {
	if (candidates.length === 0) return fallback;
	const best = candidates.reduce((a, b) => (WGSL_COMPONENTS[a] >= WGSL_COMPONENTS[b] ? a : b));
	return WGSL_COMPONENTS[best] >= WGSL_COMPONENTS[fallback] ? best : fallback;
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
	 * The concrete WGSL types this input accepts, ordered from lowest to highest
	 * (by component count). The first element is the default type used when
	 * nothing is connected and no user override is set.
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

/** Default type for an input: the lowest type in its `types` array. */
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

/** Every node that's used by SvelteFlow */
export type GroupedNode = Node & {
	group?: {
		definitionRef: string;
		locked: boolean;
	};
};

export type NodeCategory = "math" | "input" | "misc" | "color" | "vector";

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
	 * Map from input port id → WGSL variable names of the upstream node(s).
	 * For non-variadic inputs: always 0 or 1 elements.
	 * For variadic inputs: N elements (one per connected edge).
	 * These are raw (unpromoted) variable names; use `promoteInput()` to
	 * obtain a promoted expression when needed.
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
	/**
	 * The active outputs for this node instance.
	 * Determined by the node's `resolveOutputs` callback (if present),
	 * otherwise falls back to the static `outputs` array.
	 */
	resolvedOutputs: NodeOutputDef[];
	/**
	 * The active inputs for this node instance.
	 * Determined by the node's `resolveInputs` callback (if present),
	 * otherwise falls back to the static `inputs` array.
	 */
	resolvedInputs: NodeInputDef[];
	/**
	 * Return a promoted WGSL expression for the given input handle.
	 * For non-variadic: promotes the single upstream var to the resolved type.
	 * For variadic: the codegen pre-promotes all variadic operands to the
	 * resolved type, so this simply joins them with ", ".
	 */
	promoteInput: (id: string) => string;
};

export type NodeDescriptor = {
	type: string;
	label: string;
	category: NodeCategory;
	inputs: NodeInputDef[];
	outputs: NodeOutputDef[];
	defaultData: Record<string, unknown>;
	/**
	 * Resolve the output type from the resolved input type.
	 * Called once per node-wide resolution. Receives the resolved concrete
	 * type that all same-family inputs share.
	 *
	 *  - `identity` (default): output type = input type.
	 *  - `dot`: output type = "f32" regardless of input vecN type.
	 *  - `separateVec`: output type = "f32" (individual components).
	 *
	 * When omitted, defaults to `() => resolvedType`.
	 */
	resolveOutputType?: (resolvedType: WgslType) => WgslType;
	/**
	 * Resolve the active outputs based on the resolved input type.
	 * When omitted, defaults to the static `outputs` array.
	 * Used by nodes like "separate" where the number of outputs depends
	 * on the connected vector type (vec2f → 2 outputs, vec3f → 3, etc.).
	 */
	resolveOutputs?: (resolvedInputType: WgslType) => NodeOutputDef[];
	/**
	 * Resolve the active inputs based on the resolved output type.
	 * When omitted, defaults to the static `inputs` array.
	 * Used by nodes like "declare" where the number of inputs depends
	 * on the selected output type (f32 → 1 input, vec2f → 2, etc.).
	 */
	resolveInputs?: (resolvedOutputType: WgslType) => NodeInputDef[];
	/**
	 * Declare a type family for this node's output type selection.
	 * When present, the type dropdown shows these types (instead of the
	 * first input's types), and the override is stored under `key` in node data.
	 * Used by nodes like "declare" where the output type is user-selected
	 * rather than inferred from inputs.
	 */
	typeFamily?: { key: string; types: readonly WgslType[] };
	/** Emit WGSL line(s) that define `varName`.
	 *  Each returned string becomes one line inside `fn frag()`.
	 *  The `let ` / `var ` prefix is the node's own choice. */
	wgsl: (ctx: WgslCtx) => string[];
};
