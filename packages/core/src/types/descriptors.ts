import type { Asset, AssetKind } from "../assets/assets";
import type { ColorMode } from "../color/modes";
import type { TextureFormat } from "../passes/textures";
import type { InputControl } from "./controls";
import type { NodeData } from "./node-data";
import { type SocketType, type WgslType } from "./values";

// ─── Handle / descriptor types ───────────────────────────────

export type HandleDef = {
	/** Stable, generated once, never changes — this is what edges/targetHandle reference. */
	id: string;
	/** User-facing, editable later, defaults to something like "Input 1". */
	label: string;
	/** The WGSL type this handle carries. */
	type: WgslType;
	/**
	 * On a group input: makes it an enum input choosing among these: a u32,
	 * or a bool edited as a checkbox (its variants being `TOGGLE_VARIANTS`).
	 */
	variants?: EnumVariant[];
	/**
	 * On an integer group input: its value is compiled in, as an enum's is,
	 * so that it can pick among textures. Editing it recompiles the shader.
	 */
	compiled?: boolean;
	/**
	 * On a group input: the variant of one of the group's enum inputs it
	 * belongs to. Group nodes show it only while that variant is picked, so
	 * each variant has its own inputs.
	 */
	owner?: InputOwner;
	/**
	 * On a group input: the types of one of the group's type variables it's
	 * shown for. Group nodes hide it (and, for an enum, its variants' inputs)
	 * while that variable has another type, so each type can have inputs of
	 * its own.
	 */
	typeOwner?: TypeOwner;
	/**
	 * On a group's enum input: the id of the type variable deciding which of
	 * its variants are offered (see `EnumVariant.types`).
	 */
	variantsBy?: string;
	/**
	 * On a numeric group input: the range its value is kept within while
	 * edited on group nodes. Linked values pass as they are.
	 */
	min?: number;
	max?: number;
	/**
	 * On a vec3f / vec4f group input: edited on group nodes as a colour
	 * (linear RGB, alpha), by a swatch opening a picker or a wheel drawn on
	 * the node, rather than a number per component.
	 */
	display?: ColorDisplay;
};

/**
 * A type a group's sockets share: each group node gives it one of `types`,
 * inferred from what's linked to those sockets (or picked on the node).
 */
export type TypeVariable = {
	/** Stable: what sockets reference, and the key a group node forces it under. */
	id: string;
	name: string;
	/** The types it may take; the first one when nothing decides. */
	types: readonly WgslType[];
};

/**
 * What a group socket carries: a fixed type, the type of one of the
 * group's type variables, or (on an output) whatever reaches it inside.
 */
export type HandleType = SocketType | { variable: string } | { inferred: true };

/**
 * A zone item's type: a group socket's. Only a simulation zone's may be a
 * texture: WGSL can't carry one through a loop, but a texture of the
 * previous frame is kept between frames.
 */
export type ItemType = HandleType;

/**
 * A zone's state item: a fixed type; in a group, the type of one of its type
 * variables, so a loop carries values as wide as the group's; or (inferred)
 * the type of its initial value.
 */
export type ZoneItem = Omit<HandleDef, "type"> & {
	type: ItemType;
	/** What it's kept in, where it isn't decided by its type. */
	format?: TextureFormat;
	/**
	 * How the texture keeping it is sized: a scale of the canvas or of a
	 * texture, or pixels. The canvas' own size unless set. The numbers and
	 * the texture are inputs of the zone's input node.
	 */
	size?: "scale" | "pixels";
};

/** A socket of a group's boundary node: a handle whose type may be decided per group node. */
export type GroupHandleDef = Omit<HandleDef, "type"> & {
	type: HandleType;
	/** On a group output: added to preview a node inside the group, and removed by the next preview. */
	viewer?: true;
};

/** The types a group's variables take for one group node, by variable id. */
export type TypeBindings = Readonly<Record<string, WgslType>>;

/** The type a socket has with `bindings`; an inferred one is undefined (it's resolved). */
export function boundType(
	type: HandleType,
	variables: readonly TypeVariable[],
	bindings: TypeBindings,
): SocketType | undefined {
	if (typeof type === "string") return type;
	if ("inferred" in type) return undefined;
	return (
		bindings[type.variable] ?? variables.find((v) => v.id === type.variable)?.types[0] ?? "f32"
	);
}

/** Whether a group input's value can be compiled in. */
export function canCompile(handle: Pick<GroupHandleDef, "type" | "variants">): boolean {
	return !handle.variants && (handle.type === "i32" || handle.type === "u32");
}

export const COLOR_DISPLAYS = ["swatch", "wheel"] as const;
export type ColorDisplay = (typeof COLOR_DISPLAYS)[number];

/**
 * One case of an enum. `value` is what's stored and compiled: it stays the
 * same when cases are renamed or reordered, so saved choices and links to a
 * Match node's cases keep pointing at the same case.
 */
export type EnumVariant = {
	value: number;
	label: string;
	/**
	 * On an enum input with `variantsBy`: the types of that variable the
	 * variant is offered for, all of them without. With others, group nodes
	 * neither offer nor pick it: a value it holds then picks the first
	 * variant offered.
	 */
	types?: WgslType[];
};

/** The variants of a checkbox. */
export const TOGGLE_VARIANTS: readonly EnumVariant[] = [
	{ value: 0, label: "Off" },
	{ value: 1, label: "On" },
];

/** A variant of a group's enum input, by the input's handle id and the variant's value. */
export type InputOwner = { enumId: string; value: number };

/** Some of the types of a group's type variable, by the variable's id. */
export type TypeOwner = { variable: string; types: WgslType[] };

export type NodeInputDef = {
	/** Stable port identifier. Doubles as the UI handle id and the key edges reference. */
	id: string;
	label: string;
	/**
	 * The concrete WGSL types this input accepts. The first element is the
	 * default type used when nothing is connected and no user override is set.
	 *
	 * Inputs of the same "family" resolve to one concrete type across the
	 * whole node (node-wide resolution). Inputs are in the same family when
	 * their `family` keys are equal, or by default when their `types` are
	 * (see `inputFamilyKey`).
	 */
	types: readonly SocketType[];
	/**
	 * Puts the input in a family of its own choosing (see `types`), e.g. to
	 * keep apart inputs accepting the same types that resolve independently.
	 */
	family?: string;
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
	 * The input needs a value that's the same for the whole frame (a size, a
	 * count, a time): linking a value computed per pixel makes the link invalid.
	 */
	frame?: boolean;
	/**
	 * The node computes its own value when this socket is unlinked (a group
	 * node, by a Fallback node inside it), so no editor is shown for it.
	 */
	fallback?: boolean;
};

/** Default type for an input: the first type in its `types` array. */
export function inputDefaultType(input: NodeInputDef): SocketType {
	return input.types[0] ?? "f32";
}

/**
 * The key of an input's family among a node's `inputs`, under which a type
 * forced on it is stored (`NodeData.types`): its own `family`, or else the
 * id of the first input accepting the same types without one.
 */
export function inputFamilyKey(input: NodeInputDef, inputs: readonly NodeInputDef[]): string {
	if (input.family !== undefined) return input.family;
	const same = (i: NodeInputDef) =>
		i.family === undefined &&
		i.types.length === input.types.length &&
		i.types.every((t, k) => t === input.types[k]);
	return inputs.find(same)?.id ?? input.id;
}

export type NodeOutputDef = {
	/** Stable port identifier. Doubles as the UI handle id and the key edges reference. */
	id: string;
	label: string;
	type: SocketType;
};

/** A user-facing enum setting shown on the node (e.g. a comparison operator). */
export type NodeSetting = {
	/** Key of the selected value in the node's `settings`. */
	key: string;
	label: string;
	options: readonly { value: string; label: string }[];
};

/** `setting`, its key and options' values kept in its type. */
export function defineSetting<const S extends NodeSetting>(setting: S): S {
	return setting;
}

/** Read an enum setting from node data, falling back to the first option. */
export function settingValue(data: NodeData, setting: NodeSetting): string {
	const value = data.settings?.[setting.key];
	const match = setting.options.find((o) => o.value === value);
	return (match ?? setting.options[0])?.value ?? "";
}

/**
 * A larger editor drawn in a node's body, editing the node's data. Each kind
 * has its own component in a front end.
 */
export type NodeWidget =
	| NodeColorWidget
	| NodeCurveWidget
	| NodeRampWidget
	| NodeCodeWidget
	| NodeCasesWidget
	| NodeAssetWidget
	| NodeItemsWidget;

/** A hue / saturation wheel and a value ramp, editing the values of a colour's inputs. */
export type NodeColorWidget = {
	kind: "color";
	/** The enum input picking what the components are. */
	mode: string;
	/**
	 * By that enum's variant value: what the components are and the inputs
	 * holding them, each variant having its own.
	 */
	modes: Record<string, ColorWidgetMode>;
};

/** A graph editing the node's curve (`NodeData.curve`). */
export type NodeCurveWidget = { kind: "curve" };

/** A gradient editing the node's colour ramp stops (`NodeData.ramp`) and their colours. */
export type NodeRampWidget = { kind: "ramp" };

/** A code editor for the node's WGSL (`NodeData.code`) and its sockets (`NodeData.sockets`). */
export type NodeCodeWidget = { kind: "code" };

/** How many cases the node has (`NodeData.cases`), added and removed at the end. */
export type NodeCasesWidget = { kind: "cases" };

/** The project asset of kind `media` the node reads (`NodeData.asset`), and how a video plays. */
export type NodeAssetWidget = { kind: "asset"; media: AssetKind };

/** The node's items (`NodeData.items`), each with a name and a format, added and removed. */
export type NodeItemsWidget = { kind: "items" };

export type ColorWidgetMode = {
	space: ColorMode;
	components: readonly [string, string, string];
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
	| "texture"
	| "misc"
	| "layout";

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
	 * The node-wide resolved type for each value input handle (Texture
	 * inputs aren't values: see `texture`). All inputs in the same
	 * TypeFamily share the same resolved type.
	 */
	inputTypes: Record<string, WgslType>;
	/**
	 * The resolved output type for this node instance.
	 * Determined by the node's `resolveOutputType` callback. A node whose
	 * outputs are all textures computes nothing, so it's never emitted.
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
	/**
	 * An f32 / vecNf expression for a number of the node's own data, named
	 * `key` among the node's: a uniform where input values are, so editing it
	 * doesn't recompile the shader, a literal elsewhere.
	 */
	param: (key: string, value: number | readonly number[]) => string;
	/**
	 * Declare a function at the shader's top level, once however many nodes
	 * ask for it by `name`; returns `name`. Same name, same `source`.
	 */
	fn: (name: string, source: string) => string;
	/**
	 * The texture a Texture socket of the node reads (an input) or gives (an
	 * output), as a module-scope `texture_2d<f32>` of the shader.
	 */
	texture: (id: string) => string;
	/** The format of the texels of the texture `texture(id)` names. */
	textureFormat: (id: string) => TextureFormat;
	/** A sampler of the shader filtering and addressing as asked. */
	sampler: (filter: SamplerFilter, address: SamplerAddress) => string;
	/** The project asset the node reads (`NodeData.asset`), if it exists. */
	asset: () => Asset | undefined;
};

/** A value as its components. */
export type Value = number[];

/**
 * What a node's CPU implementation reads. Inputs are converted to their
 * resolved types and read lazily: a Switch computes only the case it picks.
 */
export type CpuCtx = {
	/** The value of an input. */
	input: (id: string) => Value;
	/** The values of a variadic input's operands, each converted to its resolved type. */
	operands: (id: string) => Value[];
	/** Whether something feeds the input (see `WgslCtx.isPresent`). */
	isPresent: (id: string) => boolean;
	inputTypes: Record<string, WgslType>;
	/** The resolved type of each active output. */
	outputTypes: Record<string, WgslType>;
	outputType: WgslType;
	resolvedInputs: NodeInputDef[];
	data: NodeData;
};

export const SAMPLER_FILTERS = ["linear", "nearest"] as const;
export type SamplerFilter = (typeof SAMPLER_FILTERS)[number];
export const SAMPLER_ADDRESSES = ["clamp", "repeat", "mirror"] as const;
export type SamplerAddress = (typeof SAMPLER_ADDRESSES)[number];

/**
 * A node type's behaviour. Its sockets and settings are type parameters, so
 * a descriptor made with `defineNode` (or a typed factory) keeps their ids
 * in its type: graph code written against a node type is checked by them.
 */
export type NodeDescriptor<
	In extends NodeInputDef[] = NodeInputDef[],
	Out extends NodeOutputDef[] = NodeOutputDef[],
	S extends NodeSetting[] = NodeSetting[],
> = {
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
	inputs: In;
	outputs: Out;
	defaultData: NodeData;
	/** Enum settings rendered on the node; their values live in node data. */
	settings?: S;
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
	 * Resolve the output type from the representative input type, or from
	 * the types of all its inputs. When omitted, defaults to identity.
	 */
	resolveOutputType?: (
		resolvedType: WgslType,
		inputTypes: Readonly<Record<string, WgslType>>,
	) => WgslType;
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
	 * The node's outputs computed on the CPU, one value per output id, for
	 * evaluating graphs without a GPU. f32 results are rounded with
	 * `Math.fround` and integers wrap as in WGSL, so both agree. Nodes with no
	 * meaning on the CPU (they read a pixel, a texture or custom code) have none.
	 */
	cpu?: (ctx: CpuCtx) => Record<string, Value>;
	/** Emit WGSL line(s) that define `varName`.
	 *  Each returned string becomes one statement in the current scope.
	 *  The `let ` / `var ` prefix is the node's own choice. */
	wgsl: (ctx: WgslCtx) => string[];
};

/** `descriptor`, its sockets' and settings' ids and values kept in its type. */
export function defineNode<
	const In extends NodeInputDef[],
	const Out extends NodeOutputDef[],
	const S extends NodeSetting[] = [],
>(descriptor: NodeDescriptor<In, Out, S>): NodeDescriptor<In, Out, S> {
	return descriptor;
}

/** An input socket with the id `I`. */
export type InputDef<I extends string> = NodeInputDef & { id: I };

/** A variadic input socket with the id `I`. */
export type VariadicInputDef<I extends string> = InputDef<I> & { variadic: true };

/** An output socket with the id `O`. */
export type OutputDef<O extends string> = NodeOutputDef & { id: O };

/**
 * The types a node's type picker offers and the key its pick is stored
 * under in `NodeData.types`: its `typeFamily`, or else its primary input's
 * types, inferred from links until one is picked. Undefined without a choice.
 */
export function pickableTypes(
	descriptor: NodeDescriptor,
): { key: string; types: readonly SocketType[]; inferable: boolean } | undefined {
	const family = descriptor.typeFamily;
	if (family) return family.types.length < 2 ? undefined : { ...family, inferable: false };
	const primary =
		descriptor.inputs.find((i) => i.id === descriptor.primaryInput) ?? descriptor.inputs[0];
	if (!primary || primary.types.length < 2) return undefined;
	return {
		key: inputFamilyKey(primary, descriptor.inputs),
		types: primary.types,
		inferable: true,
	};
}
