import {
	type CpuCtx,
	type ScalarKind,
	typeComponents,
	typeKind,
	type Value,
	type WgslType,
} from "../types";

type Cpu = (ctx: CpuCtx) => Record<string, Value>;

/** Component-wise `f`, a single component standing for all of them. */
export function zip(values: Value[], f: (...n: number[]) => number): Value {
	const width = Math.max(...values.map((v) => v.length));
	return Array.from({ length: width }, (_, i) =>
		f(...values.map((v) => v[v.length === 1 ? 0 : i] ?? 0)),
	);
}

/** A value with `width` components, a single one standing for all of them. */
export function fit(value: Value, width: number): Value {
	if (value.length === 1) return Array.from({ length: width }, () => value[0] ?? 0);
	return Array.from({ length: width }, (_, i) => value[i] ?? 0);
}

/** A number as a value of `type`'s kind: f32s round, integers wrap as in WGSL. */
export function asKind(type: WgslType): (n: number) => number {
	switch (typeKind(type)) {
		case "i32":
			return (n) => Math.trunc(n) | 0;
		case "u32":
			return (n) => Math.trunc(n) >>> 0;
		case "bool":
			return (n) => Number(n !== 0);
		case "f32":
			return Math.fround;
	}
}

/** An f32 as WGSL converts it to an integer: truncated, saturating at the range, NaN as 0. */
function saturate(n: number, min: number, max: number): number {
	// `+ 0` turns the -0 truncating (-1, 0) gives into the 0 an integer holds.
	return Number.isNaN(n) ? 0 : Math.min(max, Math.max(min, Math.trunc(n))) + 0;
}

/** A number of kind `from` as one of kind `to`, as WGSL's conversion constructors do. */
function convertNumber(n: number, from: ScalarKind, to: ScalarKind): number {
	switch (to) {
		case "f32":
			return Math.fround(n);
		case "bool":
			return Number(n !== 0);
		case "i32":
			// Integers and bools hold whole numbers already: only f32s saturate.
			return from === "f32" ? saturate(n, -2147483648, 2147483647) : n | 0;
		case "u32":
			return from === "f32" ? saturate(n, 0, 4294967295) : n >>> 0;
	}
}

/**
 * A value of type `from` as `to`: its width, and its kind the way WGSL
 * converts it (an f32 saturates to an integer, one integer kind
 * reinterprets the other's bits).
 */
export function convert(value: Value, from: WgslType, to: WgslType): Value {
	const source = typeKind(from);
	const kind = typeKind(to);
	return fit(value, typeComponents(to)).map((n) => convertNumber(n, source, kind));
}

/**
 * A value as `type`: its width and kind. Given the type it comes `from` it's
 * converted as WGSL does; without, a number is cut to the kind the way an
 * arithmetic result is (integers wrap).
 */
export function coerce(value: Value, type: WgslType, from?: WgslType): Value {
	if (from !== undefined) return convert(value, from, type);
	return fit(value, typeComponents(type)).map(asKind(type));
}

/** WGSL's `round`: halves go to the even neighbour. */
export function roundHalfEven(n: number): number {
	return Math.abs(n % 1) === 0.5 ? 2 * Math.round(n / 2) : Math.round(n);
}

const isInteger = (type: WgslType) => typeKind(type) === "i32" || typeKind(type) === "u32";

/** A node computing `f` of each component of `e`, giving `result`. */
export function unaryCpu(f: (n: number) => number): Cpu {
	return (ctx) => ({ result: coerce(ctx.input("e").map(f), ctx.outputType) });
}

/** A node folding its `operands` by `f`; integers use `integer` where given, for products past a float's precision. */
export function variadicCpu(
	f: (a: number, b: number) => number,
	integer?: (a: number, b: number) => number,
): Cpu {
	return (ctx) => {
		const type = ctx.outputType;
		const op = (isInteger(type) ? integer : undefined) ?? f;
		const [first, ...rest] = ctx.operands("operands");
		const result = rest.reduce(
			(a, b) => coerce(zip([a, b], op), type),
			coerce(first ?? [0], type),
		);
		return { result };
	};
}

/** A node computing `f` of the components of two inputs, giving `result`. */
export function binaryCpu(a: string, b: string, f: (a: number, b: number) => number): Cpu {
	return (ctx) => ({
		result: coerce(zip([ctx.input(a), ctx.input(b)], f), ctx.outputType),
	});
}

/** A node computing `f` of the components of its inputs, in order, giving `result`. */
export function naryCpu(ids: readonly string[], f: (...n: number[]) => number): Cpu {
	return (ctx) => ({
		result: coerce(
			zip(
				ids.map((id) => ctx.input(id)),
				f,
			),
			ctx.outputType,
		),
	});
}
