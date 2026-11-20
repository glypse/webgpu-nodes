import { type CpuCtx, typeComponents, typeKind, type Value, type WgslType } from "../types";

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

/** A value as `type`: its width and kind. */
export function coerce(value: Value, type: WgslType): Value {
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
