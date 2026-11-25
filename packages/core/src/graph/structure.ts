import { LAYOUT_FRAME } from "../frames";
import type { GraphDocumentEdge, GraphNode, HydratedGraphDocument } from "./document";

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
export function nodesStructure(doc: HydratedGraphDocument, inert?: InertInput): object {
	const known = structures.get(doc);
	if (known?.nodes === doc.nodes) return known.key;
	const key = known && sameStructure(known.nodes, doc.nodes, inert) ? known.key : {};
	structures.set(doc, { nodes: doc.nodes, key });
	return key;
}

/**
 * Layout frames and each node's `frame` are decorative: codegen and the
 * analyses never read them, so putting nodes in or out of a frame, or
 * editing a frame, keeps the structure.
 */
function sameStructure(
	a: readonly GraphNode[],
	b: readonly GraphNode[],
	inert: InertInput | undefined,
): boolean {
	const computing = (nodes: readonly GraphNode[]) => nodes.filter((n) => n.type !== LAYOUT_FRAME);
	const ca = computing(a);
	const cb = computing(b);
	return (
		ca.length === cb.length &&
		ca.every((n, i) => {
			const m = cb[i];
			return (
				m !== undefined &&
				(n === m ||
					(n.id === m.id &&
						n.type === m.type &&
						(n.data === m.data || sameData(n, m, inert)) &&
						n.group === m.group))
			);
		})
	);
}

/** Whether the value stored for `input` of `node` is read by nothing that analyses the graph. */
export type InertInput = (node: GraphNode, input: string) => boolean;

/**
 * Whether two versions of a node's data differ only in the stored values
 * of inert inputs, which is what editing a number or colour changes.
 */
function sameData(a: GraphNode, b: GraphNode, inert: InertInput | undefined): boolean {
	if (!inert) return false;
	const { values: valuesA, ...restA } = a.data;
	const { values: valuesB, ...restB } = b.data;
	const keys = Object.keys(restA);
	if (keys.length !== Object.keys(restB).length) return false;
	if (
		!keys.every(
			(k) => (restA as Record<string, unknown>)[k] === (restB as Record<string, unknown>)[k],
		)
	) {
		return false;
	}
	const ids = new Set([...Object.keys(valuesA ?? {}), ...Object.keys(valuesB ?? {})]);
	return [...ids].every((id) => valuesA?.[id] === valuesB?.[id] || inert(a, id));
}

const edgeStructures = new WeakMap<
	HydratedGraphDocument,
	{ edges: readonly GraphDocumentEdge[]; key: object }
>();

/**
 * Whether two edge lists connect the same handles in the same order. The
 * front end adds fields of its own (selection) to the edges it hands back,
 * so a list can be replaced without the graph having changed.
 */
export function sameEdges(
	a: readonly GraphDocumentEdge[],
	b: readonly GraphDocumentEdge[],
): boolean {
	return (
		a === b ||
		(a.length === b.length &&
			a.every((e, i) => {
				const f = b[i];
				return (
					f !== undefined &&
					(e === f ||
						(e.id === f.id &&
							e.source === f.source &&
							e.sourceHandle === f.sourceHandle &&
							e.target === f.target &&
							e.targetHandle === f.targetHandle))
				);
			}))
	);
}

/**
 * A key of a document's edges that only changes when what they connect
 * does: not when they are selected. Like `nodesStructure`, for analyses that
 * would otherwise be rebuilt for every new edges array.
 */
export function edgesStructure(doc: HydratedGraphDocument): object {
	const known = edgeStructures.get(doc);
	if (known?.edges === doc.edges) return known.key;
	const key = known && sameEdges(known.edges, doc.edges) ? known.key : {};
	edgeStructures.set(doc, { edges: doc.edges, key });
	return key;
}
