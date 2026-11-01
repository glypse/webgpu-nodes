import type { GraphDocumentEdge, GraphDocumentNode } from "./document";

type BranchNode = { id: string; type?: string; position: { x: number; y: number }; frame?: string };

/** Where a reroute goes, right of the output it splits. */
const REROUTE_OFFSET = 240;

/**
 * One reroute after each output linked to several inputs, its links then
 * leaving from the reroute: branches split at a point of their own, and the
 * value can be followed from there. Only outputs and inputs of nodes `among`
 * takes count; reroutes, which already are such points, and links in
 * `skipped` (broken ones) are left alone. `newId` names what's added from a
 * key unique to it. Returns the reroutes and links added, and the links
 * moved to leave from a reroute (same ids, new source).
 */
export function rerouteBranches(
	nodes: readonly BranchNode[],
	edges: readonly GraphDocumentEdge[],
	among: (nodeId: string) => boolean,
	newId: (key: string) => string,
	skipped: ReadonlySet<string> = new Set(),
): { reroutes: GraphDocumentNode[]; links: GraphDocumentEdge[]; moved: GraphDocumentEdge[] } {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const branches = new Map<string, GraphDocumentEdge[]>();
	for (const edge of edges) {
		const source = byId.get(edge.source);
		if (
			!source ||
			source.type === "reroute" ||
			skipped.has(edge.id) ||
			!among(edge.source) ||
			!among(edge.target)
		) {
			continue;
		}
		const key = `${edge.source}\0${edge.sourceHandle}`;
		branches.set(key, [...(branches.get(key) ?? []), edge]);
	}

	const reroutes: GraphDocumentNode[] = [];
	const links: GraphDocumentEdge[] = [];
	const moved: GraphDocumentEdge[] = [];
	for (const [key, group] of branches) {
		const [first] = group;
		const source = first && byId.get(first.source);
		if (!first || !source || group.length < 2) continue;
		const id = newId(`reroute/${key}`);
		reroutes.push({
			id,
			type: "reroute",
			data: {},
			position: { x: source.position.x + REROUTE_OFFSET, y: source.position.y },
			...(source.frame ? { frame: source.frame } : {}),
		});
		links.push({
			id: newId(`link/${key}`),
			source: first.source,
			sourceHandle: first.sourceHandle,
			target: id,
			targetHandle: "in",
		});
		for (const edge of group) moved.push({ ...edge, source: id, sourceHandle: "out" });
	}
	return { reroutes, links, moved };
}
