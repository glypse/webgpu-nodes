import { caseHandle, CASES_FAMILY } from "../enums";
import { MAX_CASES } from "../graph/limits";
import { type NodeData, type NodeDescriptor, SOCKET_TYPES, wgslTypeName } from "../types";

export const INDEX_SWITCH = "index-switch";
export const INDEX_SWITCH_INDEX = "index";

const DEFAULT_CASES = 2;

/** A count of cases a node can have, the nearest to `count`. */
export function clampCases(count: number): number {
	return Math.min(MAX_CASES, Math.max(1, Math.trunc(count)));
}

export function indexSwitchCases(data: NodeData): number {
	return clampCases(data.cases ?? DEFAULT_CASES);
}

/**
 * Pick one of its cases by a runtime index, as Blender's Index Switch: for
 * tables of values a loop reads one by one. An index out of range takes the
 * nearest case.
 */
export function buildIndexSwitchDescriptor(data: NodeData): NodeDescriptor {
	const count = indexSwitchCases(data);
	const cases = Array.from({ length: count }, (_, i) => caseHandle(i));
	return {
		type: INDEX_SWITCH,
		label: "Index Switch",
		aliases: ["Table", "Lookup Table", "Array", "Select by Index", "Pick"],
		category: "logic",
		primaryInput: cases[0],
		widget: { kind: "cases" },
		inputs: [
			{ id: INDEX_SWITCH_INDEX, label: "index", types: ["i32"] },
			...cases.map((id, i) => ({
				id,
				label: String(i),
				types: SOCKET_TYPES,
				family: CASES_FAMILY,
			})),
		],
		outputs: [{ id: "result", label: "result", type: "f32" }],
		defaultData: { cases: DEFAULT_CASES },
		wgsl: (ctx) => {
			const index = ctx.promoteInput(INDEX_SWITCH_INDEX);
			if (count === 1) return [`let ${ctx.varName} = ${ctx.promoteInput(caseHandle(0))};`];
			// A `var`: every WGSL compiler indexes those at runtime, not all do `let` arrays.
			const table = `${ctx.varName}_cases`;
			const type = wgslTypeName(ctx.outputType);
			const values = cases.map((id) => ctx.promoteInput(id)).join(", ");
			return [
				`var ${table} = array<${type}, ${String(count)}>(${values});`,
				`let ${ctx.varName} = ${table}[clamp(${index}, 0, ${String(count - 1)})];`,
			];
		},
	};
}
