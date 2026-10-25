import type { EnumVariant, NodeInputDef } from "./descriptors";
import type { InputValue } from "./node-data";
import { type WgslType, typeKind } from "./values";

/**
 * How the value of an unlinked input is edited. Each kind has its own editor
 * in a front end; a kind only needs to be added here and given an editor.
 */
export type InputControl =
	/** A number per component, kept within `min` and `max` while edited (not when linked). */
	| { kind: "number"; min?: number; max?: number }
	/** An on/off switch per component. */
	| { kind: "toggle" }
	/** A colour swatch opening a picker; vec3f / vec4f only (linear RGB, alpha). */
	| { kind: "color" }
	/** A colour wheel and value ramp drawn on the node; vec3f / vec4f only (linear RGB, alpha). */
	| { kind: "wheel" }
	/** A choice among an enum's variants, stored as the variant's value (a u32); linked, any scalar drives it. */
	| { kind: "enum"; variants: readonly EnumVariant[] };

export type InputControlKind = InputControl["kind"];

/**
 * Whether values edited by `control` are passed to the shader as uniforms,
 * so editing them doesn't recompile it. An enum's value is compiled in
 * instead, so only what its variant uses is computed.
 */
export function isUniformControl(control: InputControl): boolean {
	switch (control.kind) {
		case "number":
		case "toggle":
		case "color":
		case "wheel":
			return true;
		case "enum":
			return false;
	}
}

/** A stored enum value as one of `variants`' values: the first one when it isn't one. */
export function enumValue(
	stored: InputValue | undefined,
	variants: readonly EnumVariant[],
): number | undefined {
	const raw = typeof stored === "object" ? stored.x : stored;
	const value = Math.trunc(Number(raw));
	return variants.find((v) => v.value === value)?.value ?? variants[0]?.value;
}

/** The control editing an input of resolved type `type`. */
export function inputControl(input: NodeInputDef, type: WgslType): InputControl {
	const colorKind = input.control?.kind === "color" || input.control?.kind === "wheel";
	if (colorKind && type !== "vec3f" && type !== "vec4f") {
		return { kind: "number" };
	}
	const bool = typeKind(type) === "bool";
	if (input.control && !(bool && input.control.kind === "number")) return input.control;
	return bool ? { kind: "toggle" } : { kind: "number" };
}
