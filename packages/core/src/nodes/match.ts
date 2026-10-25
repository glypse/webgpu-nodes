import { MATCH, MATCH_SELECTOR, caseHandle } from "../enums";
import { type EnumVariant, type NodeDescriptor, WGSL_TYPES } from "../types";

/**
 * Pick a value by an enum's variant, one input per variant: the cases follow
 * the enum linked to it, so none can be missing or left over (as Rust's
 * `match`). When the enum's value is known while compiling, only the picked
 * case is computed.
 */
export function buildMatchDescriptor(variants: readonly EnumVariant[] = []): NodeDescriptor {
	const cases = variants.map((v) => ({ id: caseHandle(v.value), value: v.value }));
	return {
		type: MATCH,
		label: "Match",
		aliases: ["Menu Switch", "Switch Case", "Case", "Enum Switch", "Index Switch"],
		category: "logic",
		primaryInput: cases[0]?.id,
		inputs: [
			{ id: MATCH_SELECTOR, label: "enum", types: ["u32"] },
			...variants.map((v) => ({
				id: caseHandle(v.value),
				label: v.label,
				types: WGSL_TYPES,
			})),
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: {},
		...(cases.length === 0 ? { resolveOutputType: () => "f32" as const } : {}),
		wgsl: (ctx) => {
			const [first, ...rest] = cases;
			if (!first)
				return [`let ${ctx.varName} = ${ctx.convert("0.0", "f32", ctx.outputType)};`];
			const value = ctx.constant(MATCH_SELECTOR);
			if (value !== undefined) {
				const picked = cases.find((c) => c.value === value) ?? first;
				return [`let ${ctx.varName} = ${ctx.promoteInput(picked.id)};`];
			}
			const selector = ctx.promoteInput(MATCH_SELECTOR);
			// Unknown values get the first case.
			const chosen = rest.reduce(
				(acc, c) =>
					`select(${acc}, ${ctx.promoteInput(c.id)}, ${selector} == ${String(c.value)}u)`,
				ctx.promoteInput(first.id),
			);
			return [`let ${ctx.varName} = ${chosen};`];
		},
	};
}

export const matchNode = buildMatchDescriptor();
