import { componentKeys, readComponent } from "../graph/values";
import type { InputValue, ScalarKind, ScalarValue, WgslType } from "../types";
import { typeComponents, typeKind, WGSL_DEFAULTS, wgslTypeName } from "../types";

const SCALAR_LIMITS = {
	i32: { min: -2147483648, max: 2147483647 },
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

/** WGSL identifiers can't contain characters like "-" from a UUID's dashes. */
export function identSuffix(id: string): string {
	return id.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * A uniform's value: a number for an f32, its components for a vecNf.
 * Uniforms are always floats, converted to the input's type in the shader.
 */
export type UniformValue =
	number | [number, number] | [number, number, number] | [number, number, number, number];

/** The uniform holding `value`, read as `target`. */
export function uniformValue(target: WgslType, value: InputValue | undefined): UniformValue {
	const kind = typeKind(target);
	const [x = 0, y = 0, z = 0, w = 0] = componentKeys(target).map((c) =>
		scalarNumber(kind, readComponent(value, c)),
	);
	switch (typeComponents(target)) {
		case 1:
			return x;
		case 2:
			return [x, y];
		case 3:
			return [x, y, z];
		case 4:
			return [x, y, z, w];
	}
}

/** The name of the uniform holding a node's unlinked input or own number. */
export function uniformName(nodeId: string, key: string): string {
	return `u_${identSuffix(nodeId)}_${identSuffix(key)}`;
}

/** The unlinked input a uniform holds: what it's read as, and its value when the node stores none. */
export type UniformInput = {
	node: string;
	input: string;
	type: WgslType;
	fallback: InputValue | undefined;
};

/** What names the input among others', for `UniformInput`s to be told apart. */
export function uniformInputKey(node: string, input: string): string {
	return `${node}|${input}`;
}
