import type { Node } from "@xyflow/svelte";

// ─── WGSL type system ────────────────────────────────────────
export const WGSL_TYPES = ["f32", "vec2f", "vec3f", "vec4f"] as const;

export type WgslType = (typeof WGSL_TYPES)[number];

export const WGSL_DEFAULTS: Record<WgslType, string> = {
	f32: "f32(0.0)",
	vec2f: "vec2f(0.0, 0.0)",
	vec3f: "vec3f(0.0, 0.0, 0.0)",
	vec4f: "vec4f(0.0, 0.0, 0.0, 1.0)",
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

export type HandleDef = {
	id: string; // stable, generated once, never changes - this is what edges/targetHandle reference
	label: string; // user-facing, editable later, defaults to something like "Input 1"
	type: WgslType; // hardcode "f32" for now, per your call
};

// ─── Descriptor types ────────────────────────────────────────
export type NodeInputDef = {
	/** Stable port identifier. Doubles as the SvelteFlow Handle id and the key edges reference. */
	id: string;
	label: string;
	type: WgslType;
	/**
	 * If true, every edge connected to this handle is collected.
	 * The descriptor's wgsl receives `inputs[id]` as an array of upstream vars.
	 * For non-variadic, it's always 0 or 1 elements.
	 */
	variadic?: boolean;
};

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
	/** Resolved upstream variable names per input port id.
	 *  - Non-variadic: `inputs["x"]` is `[varName]` (1 element) if connected, `[]` if not.
	 *  - Variadic: `inputs["operands"]` has N elements (one per connected edge), `[]` if none.
	 *
	 *  The codegen guarantees every input declared in the node's descriptor is present,
	 *  so direct property access like `inputs.e` is always safe. */
	inputs: Record<string, string[]>;
};

export type NodeDescriptor = {
	type: string;
	label: string;
	category: NodeCategory;
	inputs: NodeInputDef[];
	outputs: NodeOutputDef[];
	defaultData: Record<string, unknown>;
	/** Emit WGSL line(s) that define `varName`.
	 *  Each returned string becomes one line inside `fn frag()`.
	 *  The `let ` / `var ` prefix is the node's own choice. */
	wgsl: (ctx: WgslCtx) => string[];
};
