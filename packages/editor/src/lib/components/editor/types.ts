import type { Node } from "@xyflow/svelte";

// ─── WGSL type system ────────────────────────────────────────
export type WgslType = "f32" | "vec2f" | "vec3f" | "vec4f";

export const WGSL_DEFAULTS: Record<WgslType, string> = {
	f32: "f32(0.0)",
	vec2f: "vec2f(0.0, 0.0)",
	vec3f: "vec3f(0.0, 0.0, 0.0)",
	vec4f: "vec4f(0.0, 0.0, 0.0, 1.0)",
};

export type HandleDef = {
	id: string; // stable, generated once, never changes — this is what edges/targetHandle reference
	label: string; // user-facing, editable later, defaults to something like "Input 1"
	type: WgslType; // hardcode "f32" for now, per your call
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

/** Every node that's used by SvelteFlow */
export type GroupedNode = Node & {
	group?: {
		definitionRef: string;
		locked: boolean;
	};
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
	/**
	 * When a node is inside a group, globals like `uv` or `motiongpuFrame.time`
	 * must be replaced with the group function's parameter names.
	 * Maps the raw WGSL reference (e.g. `"uv"`) to the parameter name
	 * (e.g. `"h_<handle-uuid>"`). If a global is NOT in this map, it means
	 * the node is at root scope and the raw reference is fine.
	 */
	globalOverrides?: Record<string, string>;
};

export type NodeDescriptor = {
	type: string;
	label: string;
	category: NodeCategory;
	inputs: NodeInputDef[];
	outputs: NodeOutputDef[];
	defaultData: Record<string, unknown>;
	/**
	 * Root-level WGSL identifiers this node references that are NOT defined
	 * inside any group (e.g. `uv`, `motiongpuFrame.time`).
	 * When a node with globals is placed inside a group, the grouping logic
	 * must create group-input handles for them, and the codegen must forward
	 * them as function arguments.
	 */
	globals?: { name: string; type: WgslType; wgslRef: string }[];
	/** Emit WGSL line(s) that define `varName`.
	 *  Each returned string becomes one line inside `fn frag()`.
	 *  The `let ` / `var ` prefix is the node's own choice. */
	wgsl: (ctx: WgslCtx) => string[];
};
