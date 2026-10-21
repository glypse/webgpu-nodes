import { type InputValue, type ScalarValue, type VectorValue, type WgslType } from "../types";
import { typeComponents } from "../types";

const VECTOR_KEYS = ["x", "y", "z", "w"] as const;
type ComponentKey = (typeof VECTOR_KEYS)[number];

/** Keys of a type's components ("_" for scalars). */
export function componentKeys(type: WgslType): string[] {
	const n = typeComponents(type);
	return n === 1 ? ["_"] : VECTOR_KEYS.slice(0, n);
}

function vectorKey(component: string): ComponentKey {
	return VECTOR_KEYS.find((k) => k === component) ?? "x";
}

/** One component of a stored input value, as a number. */
export function readComponent(stored: InputValue | undefined, component: string): number {
	const raw: ScalarValue | undefined =
		typeof stored === "object" ? stored[vectorKey(component)] : stored;
	return typeof raw === "boolean" ? Number(raw) : Number(raw) || 0;
}

/** A stored input value of `type` with one component set to `value`. */
export function withComponent(
	stored: InputValue | undefined,
	type: WgslType,
	component: string,
	value: number,
): InputValue {
	if (typeComponents(type) === 1) return value;
	const vector: VectorValue =
		typeof stored === "object"
			? { ...stored }
			: Object.fromEntries(componentKeys(type).map((c) => [c, Number(stored) || 0]));
	vector[vectorKey(component)] = value;
	return vector;
}
