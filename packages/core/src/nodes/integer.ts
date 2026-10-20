import { type NodeDescriptor, type NodeSetting, settingValue } from "../types";
import { INTEGER_TYPES, UINT_TYPES, makeType, typeComponents } from "../types";
import { binaryNode, unaryFn } from "./builders";

const BITWISE_SETTING: NodeSetting = {
	key: "op",
	label: "Operation",
	options: [
		{ value: "&", label: "And" },
		{ value: "|", label: "Or" },
		{ value: "^", label: "Xor" },
	],
};

export const bitwiseNode: NodeDescriptor = {
	...binaryNode(
		"bitwise",
		"Bitwise",
		(a, b, ctx) => `${a} ${settingValue(ctx.data, BITWISE_SETTING)} ${b}`,
		{ types: INTEGER_TYPES, category: "integer" },
	),
	defaultData: { a: 0, b: 0, op: "&" },
	settings: [BITWISE_SETTING],
};

export const bitwiseNotNode: NodeDescriptor = {
	...unaryFn("bitwise-not", "Bitwise Not", "", INTEGER_TYPES, "integer"),
	wgsl: (ctx) => [`let ${ctx.varName} = ~(${ctx.promoteInput("e")});`],
};

const SHIFT_SETTING: NodeSetting = {
	key: "op",
	label: "Direction",
	options: [
		{ value: "<<", label: "Left" },
		{ value: ">>", label: "Right" },
	],
};

export const bitShiftNode: NodeDescriptor = {
	type: "bit-shift",
	label: "Bit Shift",
	category: "integer",
	inputs: [
		{ id: "a", label: "value", types: INTEGER_TYPES },
		{ id: "b", label: "shift", types: UINT_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "i32" }],
	defaultData: { a: 0, b: 0, op: "<<" },
	settings: [SHIFT_SETTING],
	wgsl: (ctx) => {
		// WGSL wants the shift amount as u32 (or a u32 vector of the value's
		// width), strictly below the bit width: mask it so constants stay valid.
		const shiftType = makeType("u32", typeComponents(ctx.outputType));
		const amount = ctx.convert(ctx.promoteInput("b"), ctx.inputTypes.b ?? "u32", shiftType);
		const mask = typeComponents(shiftType) === 1 ? "31u" : `${shiftType}(31u)`;
		const op = settingValue(ctx.data, SHIFT_SETTING);
		return [`let ${ctx.varName} = ${ctx.promoteInput("a")} ${op} (${amount} & ${mask});`];
	},
};
