import type { ScalarKind, WgslType } from "../types";
import { WGSL_DEFAULTS, typeComponents, typeKind, wgslTypeName } from "../types";

const SCALAR_LIMITS = {
	i32: { min: -2147483647, max: 2147483647 },
	u32: { min: 0, max: 4294967295 },
};

function scalarLiteral(kind: ScalarKind, value: unknown): string {
	if (kind === "bool") {
		const truthy =
			value === true || value === "true" || (typeof value === "number" && value !== 0);
		return truthy ? "true" : "false";
	}
	const raw = Number(value);
	const n = Number.isFinite(raw) ? raw : 0;
	if (kind === "f32") return `f32(${String(n)})`;
	const { min, max } = SCALAR_LIMITS[kind];
	const int = Math.min(max, Math.max(min, Math.trunc(n)));
	return `${kind}(${String(int)})`;
}

const LITERAL_COMPONENTS = ["x", "y", "z", "w"];

/** Format a stored input value as a WGSL literal of `type`. */
export function formatWgslLiteral(type: WgslType, value: unknown): string {
	const kind = typeKind(type);
	const components = typeComponents(type);
	if (components === 1) {
		if (typeof value === "object" && value !== null) {
			return scalarLiteral(kind, (value as Record<string, unknown>).x);
		}
		return scalarLiteral(kind, value);
	}
	if (value === undefined || value === null) return WGSL_DEFAULTS[type];
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const parts = LITERAL_COMPONENTS.slice(0, components).map((c) =>
			scalarLiteral(kind, obj[c]),
		);
		return `${wgslTypeName(type)}(${parts.join(", ")})`;
	}
	return `${wgslTypeName(type)}(${scalarLiteral(kind, value)})`;
}
