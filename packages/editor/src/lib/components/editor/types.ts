// ─── WGSL type system ────────────────────────────────────────
export type WgslType = "f32" | "vec2f" | "vec3f" | "vec4f";

export const WGSL_DEFAULTS: Record<WgslType, string> = {
	f32: "f32(0.0)",
	vec2f: "vec2f(0.0, 0.0)",
	vec3f: "vec3f(0.0, 0.0, 0.0)",
	vec4f: "vec4f(0.0, 0.0, 0.0, 1.0)"
};

// ─── Descriptor types ────────────────────────────────────────
export type NodeInputDef = {
	name: string;
	type: WgslType;
	/**
	 * If true, every edge connected to this handle is collected.
	 * The descriptor's wgsl receives `inputs[name]` as an array of upstream vars.
	 * For non-variadic, it's always 0 or 1 elements.
	 */
	variadic?: boolean;
};

export type NodeOutputDef = {
	name: string;
	type: WgslType;
};

export type NodeCategory = "math" | "input" | "output" | "color" | "vector";

export type WgslCtx = {
	varName: string;
	/**
	 * Map from output name to its WGSL variable name.
	 * For single-output nodes this always has one entry pointing at the same variable as `varName`.
	 * For multi-output nodes each entry has a unique suffix: `{ x: "v_id_x", y: "v_id_y" }`.
	 */
	outputVars: Record<string, string>;
	data: Record<string, unknown>;
	/** Resolved upstream variable names per input name.
	 *  - Non-variadic: `inputs["x"]` is `[varName]` (1 element) if connected, `[]` if not.
	 *  - Variadic: `inputs["operands"]` has N elements (one per connected edge), `[]` if none. */
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
