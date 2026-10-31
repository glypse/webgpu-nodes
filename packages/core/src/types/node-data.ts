import type { CurvePoint } from "../curve/curve";
import type { GroupHandleDef, HandleDef } from "./descriptors";
import type { WgslType } from "./values";

/** One component of an input value. */
export type ScalarValue = number | boolean;

/** Per-component values of a vector input. */
export type VectorValue = Partial<Record<"x" | "y" | "z" | "w", ScalarValue>>;

/**
 * The value an input holds while unlinked: a scalar (which fills every
 * component of a vector) or per-component values.
 */
export type InputValue = ScalarValue | VectorValue;

/** Everything a node stores. Which fields apply depends on the node type. */
export type NodeData = {
	/** The name the user gave the node, shown instead of its default one. */
	label?: string;
	/** Values of the node's unlinked inputs, by input id. */
	values?: Record<string, InputValue>;
	/** Enum settings shown on the node, by setting key. */
	settings?: Record<string, string>;
	/** Types the user forced, by type family key. */
	types?: Record<string, WgslType>;
	/** A group boundary node's handles. */
	handles?: GroupHandleDef[];
	/** A Repeat Output's state items. */
	items?: HandleDef[];
	/** A Repeat Input's partner. */
	pairedOutput?: string;
	/** A Repeat Input's iteration safety cap. */
	maxIterations?: number;
	/** A Curve's control points, sorted by x. */
	curve?: CurvePoint[];
	/** A Custom WGSL node's function body. */
	code?: string;
	/** A Custom WGSL node's sockets; their labels name them in `code`. */
	sockets?: { inputs: HandleDef[]; outputs: HandleDef[] };
};

/** `data` with `defaults` filled in where it has no value of its own. */
export function withDefaults(data: NodeData, defaults: NodeData): NodeData {
	return {
		...defaults,
		...data,
		...(defaults.values || data.values
			? { values: { ...defaults.values, ...data.values } }
			: {}),
		...(defaults.settings || data.settings
			? { settings: { ...defaults.settings, ...data.settings } }
			: {}),
	};
}
