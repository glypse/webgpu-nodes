import type { NodeInputDef } from "./descriptors";
import { type WgslType, typeKind } from "./values";

/**
 * How the value of an unlinked input is edited. Each kind has its own editor
 * in a front end; a kind only needs to be added here and given an editor.
 */
export type InputControl =
	/** A number per component. */
	| { kind: "number" }
	/** An on/off switch per component. */
	| { kind: "toggle" }
	/** A choice among named options, stored as the option's index (a u32); linked, any scalar drives it. */
	| { kind: "enum"; options: readonly string[] };

export type InputControlKind = InputControl["kind"];

/** The control editing an input of resolved type `type`. */
export function inputControl(input: NodeInputDef, type: WgslType): InputControl {
	if (input.control) return input.control;
	return typeKind(type) === "bool" ? { kind: "toggle" } : { kind: "number" };
}
