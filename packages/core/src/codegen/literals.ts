import type { InputValue, ScalarKind, ScalarValue, WgslType } from "../types";
import { WGSL_DEFAULTS, typeComponents, typeKind, wgslTypeName } from "../types";

const SCALAR_LIMITS = {
	i32: { min: -2147483647, max: 2147483647 },
	u32: { min: 0, max: 4294967295 },
};

/** A stored component as a number of `kind`'s range (bools are 0 or 1). */
export function scalarNumber(kind: ScalarKind, value: ScalarValue | undefined): number {
	if (kind === "bool")
		return value === true || (typeof value === "number" && value !== 0) ? 1 : 0;
	const raw = Number(value);
	const n = Number.isFinite(raw) ? raw : 0;
	if (kind === "f32") return n;
	const { min, max } = SCALAR_LIMITS[kind];
	return Math.min(max, Math.max(min, Math.trunc(n)));
}

function scalarLiteral(kind: ScalarKind, value: ScalarValue | undefined): string {
	const n = scalarNumber(kind, value);
	if (kind === "bool") return n === 1 ? "true" : "false";
	return `${kind}(${String(n)})`;
}

const LITERAL_COMPONENTS = ["x", "y", "z", "w"] as const;

/** Format a stored input value as a WGSL literal of `type`. */
export function formatWgslLiteral(type: WgslType, value: InputValue | undefined): string {
	const kind = typeKind(type);
	const components = typeComponents(type);
	if (components === 1) {
		return scalarLiteral(kind, typeof value === "object" ? value.x : value);
	}
	if (value === undefined) return WGSL_DEFAULTS[type];
	if (typeof value === "object") {
		const parts = LITERAL_COMPONENTS.slice(0, components).map((c) =>
			scalarLiteral(kind, value[c]),
		);
		return `${wgslTypeName(type)}(${parts.join(", ")})`;
	}
	return `${wgslTypeName(type)}(${scalarLiteral(kind, value)})`;
}
