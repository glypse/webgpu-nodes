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
