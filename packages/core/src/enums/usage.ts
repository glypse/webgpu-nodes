import type { GraphDocumentEdge, GraphNode, HydratedGraphDocument } from "../graph/document";
import { enumValue } from "../types";
import { REPEAT_INPUT, pairedOutputId } from "../zones";
import { type EnumDocument, constantAt, liveEdges } from "./analysis";

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

/**
 * The handles of a definition's group input whose value can reach its
 * outputs when its enums have the values in `constants`: those only feeding
 * cases a Match node doesn't pick (here or in nested groups) are left out.
 */
export function usedGroupInputs(
	definitions: Definitions,
	definitionRef: string,
	constants: ReadonlyMap<string, number>,
	visiting: ReadonlySet<string> = new Set(),
): Set<string> {
	const used = new Set<string>();
	const doc = definitions.get(definitionRef);
	if (!doc || visiting.has(definitionRef)) return used;
	const inner = new Set([...visiting, definitionRef]);

	const live = new Set(liveEdges(doc, doc.edges, constants));
	const nestedUsed = new Map<string, Set<string>>();
	const usesInput = (target: GraphNode, edge: GraphDocumentEdge): boolean => {
		if (target.type !== "node-group" || !target.group) return true;
		let found = nestedUsed.get(target.id);
		if (!found) {
			const nested = groupConstants(doc, target, definitions, constants);
			found = usedGroupInputs(definitions, target.group.definitionRef, nested, inner);
			nestedUsed.set(target.id, found);
		}
		return found.has(edge.targetHandle);
	};

	// A Repeat Output depends on its Repeat Input, though no link says so.
	const zoneInputOf = new Map<string, string>();
	for (const node of doc.nodes) {
		const output = node.type === REPEAT_INPUT ? pairedOutputId(node) : undefined;
		if (output) zoneInputOf.set(output, node.id);
	}

	const queue = doc.nodes.filter((n) => n.type === "group-output").map((n) => n.id);
	const reached = new Set(queue);
	const visit = (id: string) => {
		if (reached.has(id)) return;
		reached.add(id);
		queue.push(id);
	};
	for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
		const target = doc.nodesById.get(id);
		if (!target) continue;
		const zoneInput = zoneInputOf.get(id);
		if (zoneInput) visit(zoneInput);
		for (const edge of doc.edgesByTarget.get(id) ?? []) {
			if (!live.has(edge) || !usesInput(target, edge)) continue;
			const source = doc.nodesById.get(edge.source);
			if (source?.type === "group-input") used.add(edge.sourceHandle);
			else visit(edge.source);
		}
	}
	return used;
}
