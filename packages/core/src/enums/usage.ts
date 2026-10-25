import type { GraphNode, HydratedGraphDocument } from "../graph/document";
import { enumValue } from "../types";
import { type EnumDocument, constantAt } from "./analysis";

type Definitions = ReadonlyMap<string, HydratedGraphDocument>;

/**
 * The enum values a group node sets while compiling, by its definition's
 * handle id: those of unlinked enum inputs (its own value, or the group's
 * default), and of linked ones fed by a value known in `doc` (`constants`).
 */
export function groupConstants(
	doc: EnumDocument,
	node: Pick<GraphNode, "id" | "data" | "group">,
	definitions: Definitions,
	constants: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
	const definition = node.group && definitions.get(node.group.definitionRef);
	const input = definition?.nodes.find((n) => n.type === "group-input");
	const linked = new Set((doc.edgesByTarget.get(node.id) ?? []).map((e) => e.targetHandle));
	const values = new Map<string, number>();
	for (const handle of input?.data.handles ?? []) {
		if (!handle.variants) continue;
		const value = linked.has(handle.id)
			? constantAt(doc, node.id, handle.id, constants)
			: enumValue(
					node.data.values?.[handle.id] ?? input?.data.values?.[handle.id],
					handle.variants,
				);
		if (value !== undefined) values.set(handle.id, value);
	}
	return values;
}
