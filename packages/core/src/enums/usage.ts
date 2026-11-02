import type { GraphNode, HydratedGraphDocument } from "../graph/document";
import { enumValue, type TypeBindings } from "../types";
import { constantAt, type EnumDocument } from "./analysis";
import { availableVariants } from "./shape";

type Definitions = ReadonlyMap<string, HydratedGraphDocument>;

/**
 * The enum values a group node sets while compiling, by its definition's
 * handle id: those of unlinked enum inputs (its own value, or the group's
 * default), and of linked ones fed by a value known in `doc` (`constants`).
 * Each is one of the variants offered with the node's `bindings`.
 */
export function groupConstants(
	doc: EnumDocument,
	node: Pick<GraphNode, "id" | "data" | "group">,
	definitions: Definitions,
	bindings: TypeBindings,
	constants: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
	const definition = node.group && definitions.get(node.group.definitionRef);
	const linked = new Set((doc.edgesByTarget.get(node.id) ?? []).map((e) => e.targetHandle));
	const values = new Map<string, number>();
	for (const handle of definition?.inputs ?? []) {
		if (!handle.variants) continue;
		const variants = availableVariants(handle.variants, bindings);
		const known = linked.has(handle.id)
			? constantAt(doc, node.id, handle.id, constants)
			: (node.data.values?.[handle.id] ?? definition?.defaults[handle.id] ?? 0);
		const value = known === undefined ? undefined : enumValue(known, variants);
		if (value !== undefined) values.set(handle.id, value);
	}
	return values;
}
