import { type HelperName, type WgslType, wgslTypeName } from "../types";

//
// WGSL built-ins (sin, min, clamp, ...) and operators already work on every
// vector type. Helpers cover the gaps: guarded division / modulo / pow that
// must not produce inf/NaN (or shader-creation errors on constant operands).
//
// Each helper is overloaded per concrete type (`safeDivVec3i`, ...). Nodes ask
// for the overload they need through `WgslCtx.helper`; the code generator
// records the request and only emits overloads the shader actually uses.
//
// Helpers are written vector-wise: `T()` is the zero value of `T`, and
// comparisons on vectors yield bool vectors, which `select` accepts.

const HELPER_BODIES: Record<HelperName, (t: string) => string> = {
	/** `a / b`, returning 0 where `b == 0` (instead of inf/NaN). */
	safeDiv: (t) => `select(a / b, ${t}(), b == ${t}())`,
	/** `a % b`, returning 0 where `b == 0`. */
	safeMod: (t) => `select(a % b, ${t}(), b == ${t}())`,
	/** `pow(a, b)`, returning 1 where `b == 0` (x^0 = 1, where WGSL may give NaN). */
	safePow: (t) => `select(pow(a, b), ${t}(1), b == ${t}())`,
};

/** The name of a helper's overload for `type`. */
export function cwFnName(op: HelperName, type: WgslType): string {
	const suffix = type.charAt(0).toUpperCase() + type.slice(1);
	return `${op}${suffix}`;
}

export function emitHelper(op: HelperName, type: WgslType): string {
	const t = wgslTypeName(type);
	return `fn ${cwFnName(op, type)}(a: ${t}, b: ${t}) -> ${t} {\n  return ${HELPER_BODIES[op](t)};\n}`;
}

/** Collects the helper overloads requested while generating one shader. */
export class HelperRegistry {
	private used = new Map<string, { op: HelperName; type: WgslType }>();

	use(op: HelperName, type: WgslType): string {
		const name = cwFnName(op, type);
		if (!this.used.has(name)) this.used.set(name, { op, type });
		return name;
	}

	/** Every requested overload, in a stable (sorted) order. */
	emit(): string[] {
		return [...this.used.entries()]
			.toSorted(([a], [b]) => a.localeCompare(b))
			.map(([, { op, type }]) => emitHelper(op, type));
	}
}
