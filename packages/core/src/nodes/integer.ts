import {
	defineNode,
	defineSetting,
	INTEGER_TYPES,
	makeType,
	settingValue,
	typeComponents,
	typeKind,
	UINT_TYPES,
} from "../types";
import { binaryNode, unaryFn } from "./builders";
import { coerce, unaryCpu, zip } from "./cpu";

const BITWISE: Record<string, (a: number, b: number) => number> = {
	"&": (a, b) => a & b,
	"|": (a, b) => a | b,
	"^": (a, b) => a ^ b,
};

const BITWISE_SETTING = defineSetting({
	key: "op",
	label: "Operation",
	options: [
		{ value: "&", label: "And" },
		{ value: "|", label: "Or" },
		{ value: "^", label: "Xor" },
	],
});

export const bitwiseNode = defineNode({
	...binaryNode(
		"bitwise",
		"Bitwise",
		(a, b, ctx) => `${a} ${settingValue(ctx.data, BITWISE_SETTING)} ${b}`,
		{ types: INTEGER_TYPES, category: "integer" },
	),
	cpu: (ctx) => {
		const op = BITWISE[settingValue(ctx.data, BITWISE_SETTING)];
		return {
			result: coerce(
				zip([ctx.input("a"), ctx.input("b")], (a, b) => op?.(a, b) ?? 0),
				ctx.outputType,
			),
		};
	},
	aliases: ["Bitwise And", "Bitwise Or", "Bitwise Xor"],
	defaultData: { values: { a: 0, b: 0 }, settings: { op: "&" } },
	settings: [BITWISE_SETTING],
});

export const bitwiseNotNode = defineNode({
	...unaryFn("bitwise-not", "Bitwise Not", "", INTEGER_TYPES, "integer"),
	cpu: unaryCpu((n) => ~n),
	aliases: ["Complement", "Bit Invert"],
	wgsl: (ctx) => [`let ${ctx.varName} = ~(${ctx.promoteInput("e")});`],
});

const SHIFT_SETTING = defineSetting({
	key: "op",
	label: "Direction",
	options: [
		{ value: "<<", label: "Left" },
		{ value: ">>", label: "Right" },
	],
});

export const bitShiftNode = defineNode({
	type: "bit-shift",
	label: "Bit Shift",
	aliases: ["Shift Left", "Shift Right", "Left Shift", "Right Shift"],
	category: "integer",
	inputs: [
		{ id: "a", label: "value", types: INTEGER_TYPES },
		{ id: "b", label: "shift", types: UINT_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "i32" }],
	defaultData: { values: { a: 0, b: 0 }, settings: { op: "<<" } },
	settings: [SHIFT_SETTING],
	cpu: (ctx) => {
		const right = settingValue(ctx.data, SHIFT_SETTING) === ">>";
		const unsigned = typeKind(ctx.outputType) === "u32";
		return {
			result: coerce(
				zip([ctx.input("a"), ctx.input("b")], (a, b) =>
					right ? (unsigned ? a >>> (b & 31) : a >> (b & 31)) : a << (b & 31),
				),
				ctx.outputType,
			),
		};
	},
	wgsl: (ctx) => {
		// WGSL wants the shift amount as u32 (or a u32 vector of the value's
		// width), strictly below the bit width: mask it so constants stay valid.
		const shiftType = makeType("u32", typeComponents(ctx.outputType));
		const amount = ctx.convert(ctx.promoteInput("b"), ctx.inputTypes.b ?? "u32", shiftType);
		const mask = typeComponents(shiftType) === 1 ? "31u" : `${shiftType}(31u)`;
		const op = settingValue(ctx.data, SHIFT_SETTING);
		return [`let ${ctx.varName} = ${ctx.promoteInput("a")} ${op} (${amount} & ${mask});`];
	},
});
