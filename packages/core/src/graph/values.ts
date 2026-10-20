import { type WgslType, typeComponents } from "../types";

// How input values are stored in node data: a number (or bool) for scalars,
// `{ x, y, ... }` for vectors, where a plain scalar fills every component.

const VECTOR_KEYS = ["x", "y", "z", "w"];

/** Keys of a type's components ("_" for scalars). */
export function componentKeys(type: WgslType): string[] {
	const n = typeComponents(type);
	return n === 1 ? ["_"] : VECTOR_KEYS.slice(0, n);
}

/** One component of a stored input value, as a number. */
export function readComponent(stored: unknown, component: string): number {
	if (stored && typeof stored === "object") {
		const raw = (stored as Record<string, unknown>)[component === "_" ? "x" : component];
		return typeof raw === "boolean" ? Number(raw) : Number(raw) || 0;
	}
	if (typeof stored === "boolean") return Number(stored);
	return Number(stored) || 0;
}

/** A stored input value of `type` with one component set to `value`. */
export function withComponent(
	stored: unknown,
	type: WgslType,
	component: string,
	value: number,
): unknown {
	if (typeComponents(type) === 1) return value;
	const vector: Record<string, unknown> =
		stored && typeof stored === "object"
			? { ...(stored as Record<string, unknown>) }
			: Object.fromEntries(componentKeys(type).map((c) => [c, Number(stored) || 0]));
	vector[component] = value;
	return vector;
}
