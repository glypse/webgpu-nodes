import type { InputControl } from "./controls";
import type { NodeData } from "./node-data";
import { type WgslType } from "./values";

// ─── Handle / descriptor types ───────────────────────────────

export type HandleDef = {
	/** Stable, generated once, never changes — this is what edges/targetHandle reference. */
	id: string;
	/** User-facing, editable later, defaults to something like "Input 1". */
	label: string;
	/** The WGSL type this handle carries. */
	type: WgslType;
	/** On a group input: makes it an enum input (type u32) choosing among these. */
	variants?: EnumVariant[];
};

/**
 * One case of an enum. `value` is what's stored and compiled: it stays the
 * same when cases are renamed or reordered, so saved choices and links to a
 * Match node's cases keep pointing at the same case.
 */
export type EnumVariant = { value: number; label: string };

export type NodeInputDef = {
	/** Stable port identifier. Doubles as the UI handle id and the key edges reference. */
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
	/**
	 * How the input's value is edited while unlinked. Defaults to one
	 * following its resolved type (see `inputControl`).
	 */
	control?: InputControl;
	/**
	 * On a group node: the group computes its own value when this socket is
	 * unlinked (a Fallback node inside it), so no editor is shown for it.
	 */
	fallback?: boolean;
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
	return familyKey(input.types);
}

/** The family key of inputs accepting `types` (see `inputFamilyKey`). */
export function familyKey(types: readonly WgslType[]): string {
	return types.join(",");
}

export type NodeOutputDef = {
	/** Stable port identifier. Doubles as the UI handle id and the key edges reference. */
	id: string;
	label: string;
	type: WgslType;
};

/** A user-facing enum setting shown on the node (e.g. a comparison operator). */
export type NodeSetting = {
	/** Key of the selected value in the node's `settings`. */
	key: string;
	label: string;
	options: readonly { value: string; label: string }[];
};

/** Read an enum setting from node data, falling back to the first option. */
export function settingValue(data: NodeData, setting: NodeSetting): string {
	const value = data.settings?.[setting.key];
	const match = setting.options.find((o) => o.value === value);
	return (match ?? setting.options[0])?.value ?? "";
}

/**
 * A larger editor drawn in a node's body, editing the values of its unlinked
 * inputs. Each kind has its own component in a front end.
 */
export type NodeWidget =
	/** A hue / saturation wheel and a value ramp, for a Color node's components. */
	{ kind: "color" };

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
	data: NodeData;
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
	/**
	 * Whether an input carries a value, known while compiling: false when
	 * nothing feeds it, or when it comes from a group input whose socket the
	 * calling group node left unlinked (see the Fallback node).
	 */
	isPresent: (id: string) => boolean;
	/** Convert an expression between two types (see `convertVar`). */
	convert: (expr: string, source: WgslType, target: WgslType) => string;
	/** Request a shared helper function overload; returns its name. */
	helper: (name: HelperName, type: WgslType) => string;
	/**
	 * The value an input has while compiling, when known: it comes from an
	 * enum the calling group node set (see the Match node).
	 */
	constant: (id: string) => number | undefined;
};

export type NodeDescriptor = {
	type: string;
	label: string;
	/**
	 * Other names the add menu's search finds it by: what the equivalent node
	 * is called in other tools (Blender, TouchDesigner, Unreal, …).
	 */
	aliases?: readonly string[];
	category: NodeCategory;
	/** Hide from the "add node" menu (e.g. nodes created in pairs). */
	hidden?: boolean;
	/** A debugging aid: only offered while developer tools are enabled. */
	dev?: boolean;
	inputs: NodeInputDef[];
	outputs: NodeOutputDef[];
	defaultData: NodeData;
	/** Enum settings rendered on the node; their values live in node data. */
	settings?: NodeSetting[];
	/**
	 * The input whose family drives the node's "representative" type.
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
	 * Resolve the active inputs based on the resolved output type and the
	 * node's data (e.g. a setting renaming them).
	 * When omitted, defaults to the static `inputs` array.
	 */
	resolveInputs?: (resolvedOutputType: WgslType, data: NodeData) => NodeInputDef[];
	/**
	 * Declare a type family for this node's output type selection.
	 * When present, the type dropdown shows these types (instead of the
	 * primary input's types), and the override is stored under `key` in the node's `types`.
	 */
	typeFamily?: { key: string; types: readonly WgslType[] };
	/** An editor drawn in the node's body, for the values of its inputs. */
	widget?: NodeWidget;
	/**
	 * The node's data once setting `key` is set to `value`, for a setting
	 * changing what stored values mean (e.g. converting them so they keep
	 * their meaning). `linked` holds the ids of linked inputs, whose stored
	 * values aren't used. When omitted, only the setting changes.
	 */
	withSetting?: (
		data: NodeData,
		key: string,
		value: string,
		linked: ReadonlySet<string>,
	) => NodeData;
	/** Emit WGSL line(s) that define `varName`.
	 *  Each returned string becomes one statement in the current scope.
	 *  The `let ` / `var ` prefix is the node's own choice. */
	wgsl: (ctx: WgslCtx) => string[];
};
