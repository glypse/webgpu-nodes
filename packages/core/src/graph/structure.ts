import type { GraphNode, HydratedGraphDocument } from "./document";

const structures = new WeakMap<
	HydratedGraphDocument,
	{ nodes: readonly GraphNode[]; key: object }
>();

/**
 * A key of a document's nodes that only changes when what they compute
 * might: not when they are moved, resized or selected. Dragging a node
 * replaces the nodes array on every pointer move, and analyses keyed on the
 * array itself would be rebuilt for each.
 *
 * Nodes keep their `data` and `group` objects when only laid out, so
 * comparing those by identity is enough.
 *
 * Rust: the document would carry a structure revision bumped by the edits
 * that change it, instead of comparing node lists.
 */
export function nodesStructure(doc: HydratedGraphDocument): object {
	const known = structures.get(doc);
	if (known?.nodes === doc.nodes) return known.key;
	const key = known && sameStructure(known.nodes, doc.nodes) ? known.key : {};
	structures.set(doc, { nodes: doc.nodes, key });
	return key;
}

function sameStructure(a: readonly GraphNode[], b: readonly GraphNode[]): boolean {
	return (
		a.length === b.length &&
		a.every((n, i) => {
			const m = b[i];
			return (
				m !== undefined &&
				(n === m ||
					(n.id === m.id &&
						n.type === m.type &&
						n.data === m.data &&
						n.group === m.group &&
						n.frame === m.frame))
			);
		})
	);
}
