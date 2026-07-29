import type { WgslType } from "./types";

// ── Component-wise operation helpers ──────────────────────────────────────────
//
// WGSL built-in functions (sin, cos, min, max, clamp, mix, pow, abs, ...)
// already work on vec types natively.  Arithmetic operators (+, -, *, /)
// also work component-wise.  The only gap is *custom* helpers like safeDiv
// that must be explicitly overloaded for each type.
//
// This module provides a tiny system for generating those overloads.

const ALL_TYPES: WgslType[] = ["f32", "vec2f", "vec3f", "vec4f"];

const COMPONENTS: Record<WgslType, string[]> = {
	f32: [],
	vec2f: ["x", "y"],
	vec3f: ["x", "y", "z"],
	vec4f: ["x", "y", "z", "w"],
};

/**
 * Describes a scalar binary operation to be overloaded for all WGSL types.
 *
 * @param name        WGSL function name (e.g. "safeDiv")
 * @param scalarImpl  Given two WGSL expression strings for scalars,
 *                    return the WGSL expression for the result.
 */
export type ComponentWiseBinaryOp = {
	name: string;
	scalarImpl: (a: string, b: string) => string;
};

/**
 * Generate WGSL function overloads for a binary operation across all types.
 *
 * Each overload gets a unique name: `{name}F32`, `{name}Vec2f`, etc.
 *
 * @example
 * ```wgsl
 * fn safeDivF32(a: f32, b: f32) -> f32 {
 *   return select(a / b, 0.0, b == 0.0);
 * }
 * fn safeDivVec2f(a: vec2f, b: vec2f) -> vec2f {
 *   return vec2f(select(a.x / b.x, 0.0, b.x == 0.0), select(a.y / b.y, 0.0, b.y == 0.0));
 * }
 * ```
 */
export function generateBinaryOverloads(op: ComponentWiseBinaryOp): string[] {
	return ALL_TYPES.map((type) => {
		const fnName = cwFnName(op.name, type);
		const args = `a: ${type}, b: ${type}`;
		let body: string;
		if (type === "f32") {
			body = `  return ${op.scalarImpl("a", "b")};`;
		} else {
			const comps = COMPONENTS[type];
			const perComponent = comps.map((c) => op.scalarImpl(`a.${c}`, `b.${c}`)).join(", ");
			body = `  return ${type}(${perComponent});`;
		}
		return `fn ${fnName}(${args}) -> ${type} {\n${body}\n}`;
	});
}

/**
 * Map a WgslType to a typed function name.
 * `"f32"` → `"safeDivF32"`, `"vec2f"` → `"safeDivVec2f"`, etc.
 */
export function cwFnName(op: string, type: WgslType): string {
	const suffix = type.charAt(0).toUpperCase() + type.slice(1);
	return `${op}${suffix}`;
}

// ── Built-in operations ──────────────────────────────────────────────────────

/**
 * `safeDiv(a, b)` → `a / b` with a zero-divisor guard.
 * Returns 0.0 when b == 0 instead of producing inf/NaN.
 */
export const safeDivOp: ComponentWiseBinaryOp = {
	name: "safeDiv",
	scalarImpl: (a, b) => `select(${a} / ${b}, 0.0, ${b} == 0.0)`,
};

/**
 * `safePow(a, b)` → `pow(a, b)` with a zero-exponent guard.
 * Returns 1.0 when b == 0 (mathematically correct: x^0 = 1)
 * instead of producing undefined/NaN from WGSL's `pow`.
 */
export const safePowOp: ComponentWiseBinaryOp = {
	name: "safePow",
	scalarImpl: (a, b) => `select(pow(${a}, ${b}), 1.0, ${b} == 0.0)`,
};

/**
 * Emit all required helper overloads.  Call this once per shader;
 * the returned strings should go into the "Common libraries" section.
 */
export function emitHelperFunctions(): string[] {
	return [...generateBinaryOverloads(safeDivOp), ...generateBinaryOverloads(safePowOp)];
}
