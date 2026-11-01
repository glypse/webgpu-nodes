import { defaultDataForType } from "../nodes/registry";
import type { NodeData } from "../types";
import type {
	GraphDocumentEdge,
	GraphDocumentNode,
	GraphEdge,
	GraphNode,
	HydratedGraphDocument,
} from "./document";
import { BOUNDARY_TYPES, cloneSubgraph } from "./editing";
import { hydrateNode, serialiseEdge, serialiseNode } from "./hydrate";
import { CustomWgslModel } from "./model-custom";

/** Nodes copied out of a document, with the links between them. */
export type NodeClipboard = {
	nodes: GraphDocumentNode[];
	edges: GraphDocumentEdge[];
	/** The document they were copied from. */
	from: string;
};

export type Connection = {
	source: string;
	sourceHandle: string;
	target: string;
	targetHandle: string;
};

type Point = { x: number; y: number };

/**
 * Editing nodes of the document in view as a whole: copy and paste, delete
 * and dissolve, reset, labels, and inserting reroutes into links. Deleting
 * a frame keeps what it holds.
 */
export abstract class EditModel extends CustomWgslModel {
	abstract isValidConnection(connection: Connection): boolean;
	abstract connect(connection: Connection): void;

	/**
	 * Copy nodes of the active document, frames with what they hold and a
	 * zone's boundaries always together. The fragment output, which a
	 * document has one of, is left out. Undefined when nothing can be copied.
	 */
	copyNodes(nodeIds: Iterable<string>): NodeClipboard | undefined {
		const doc = this.activeDocument;
		const ids = this.withZonePartners(this.withFrameContents(doc, nodeIds));
		const nodes = doc.nodes.filter((n) => ids.has(n.id) && n.deletable !== false);
		if (nodes.length === 0) return undefined;
		const kept = new Set(nodes.map((n) => n.id));
		return {
			from: this.activeDefinitionRef,
			nodes: nodes.map((n) => structuredClone(serialiseNode(n))),
			edges: doc.edges
				.filter((e) => kept.has(e.source) && kept.has(e.target))
				.map(serialiseEdge),
		};
	}

	/**
	 * Add copies of clipboard nodes to the active document, selected (and the
	 * rest deselected), their top-left corner at `position` or where they were
	 * copied from. Group nodes of a group that's gone, or that would contain
	 * itself, are skipped, and so are boundary nodes of another group.
	 * Returns the new ids.
	 */
	pasteNodes(clipboard: NodeClipboard, position?: Point): string[] {
		if (this.isLocked) return [];
		// A group's boundary nodes show its own inputs and outputs: they're
		// only pasted back into it.
		const home = clipboard.from === this.activeDefinitionRef;
		const nodes = clipboard.nodes.filter(
			(n) =>
				(home || !BOUNDARY_TYPES.has(n.type)) &&
				(!n.group ||
					(this.project.definitions.has(n.group.definitionRef) &&
						!this.wouldCreateCycle(n.group.definitionRef))),
		);
		if (nodes.length === 0) return [];
		const offset = position
			? {
					x: position.x - Math.min(...nodes.map((n) => n.position.x)),
					y: position.y - Math.min(...nodes.map((n) => n.position.y)),
				}
			: { x: 0, y: 0 };
		const copies = cloneSubgraph(nodes, clipboard.edges, offset);
		const doc = this.activeDocument;
		this.setContent(doc, {
			nodes: [
				...doc.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
				...copies.nodes.map((n) => ({ ...hydrateNode(n), selected: true })),
			],
			edges: [...doc.edges, ...copies.edges],
		});
		const ids = copies.nodes.map((n) => n.id);
		this.selectedNodeIds = ids;
		this.rebuildTypeCache();
		return ids;
	}

	/** Copies of nodes, in place and selected. Returns the new ids. */
	duplicateNodes(nodeIds: Iterable<string>): string[] {
		const clipboard = this.copyNodes(nodeIds);
		return clipboard ? this.pasteNodes(clipboard) : [];
	}

	/** Select exactly these nodes of the active document. */
	selectNodes(nodeIds: Iterable<string>) {
		const ids = new Set(nodeIds);
		const doc = this.activeDocument;
		this.setContent(doc, {
			nodes: doc.nodes.map((n) =>
				(n.selected ?? false) === ids.has(n.id) ? n : { ...n, selected: ids.has(n.id) },
			),
		});
		this.selectedNodeIds = doc.nodes.filter((n) => ids.has(n.id)).map((n) => n.id);
	}

	/** Move nodes of the active document by an offset from the positions given. */
	moveNodes(from: ReadonlyMap<string, Point>, offset: Point) {
		const doc = this.activeDocument;
		this.setContent(doc, {
			nodes: doc.nodes.map((n) => {
				const start = from.get(n.id);
				return start
					? { ...n, position: { x: start.x + offset.x, y: start.y + offset.y } }
					: n;
			}),
		});
	}

	/**
	 * Delete nodes and links of the active document, with the links of the
	 * nodes and the partner of any zone boundary. Nodes a document must keep
	 * are left. Returns whether anything was deleted.
	 */
	deleteNodes(nodeIds: Iterable<string>, edgeIds: Iterable<string> = []): boolean {
		if (this.isLocked) return false;
		const doc = this.activeDocument;
		const ids = new Set(nodeIds);
		const nodes = doc.nodes.filter((n) => ids.has(n.id) && n.deletable !== false);
		const edgeSet = new Set(edgeIds);
		const expanded = this.expandDeletion(
			nodes,
			doc.edges.filter((e) => edgeSet.has(e.id)),
		);
		const removed = new Set(expanded.nodes.map((n) => n.id));
		const removedEdges = new Set(expanded.edges.map((e) => e.id));
		const edges = doc.edges.filter(
			(e) => !removedEdges.has(e.id) && !removed.has(e.source) && !removed.has(e.target),
		);
		if (removed.size === 0 && edges.length === doc.edges.length) return false;
		// What a deleted frame held stays, in the frame around it.
		const { frameOf } = this.frameAnalysis(doc);
		const kept = (frame: string | undefined): string | undefined =>
			frame !== undefined && removed.has(frame) ? kept(frameOf.get(frame)) : frame;
		this.setContent(doc, {
			nodes: doc.nodes.flatMap((n) => {
				if (removed.has(n.id)) return [];
				const frame = kept(frameOf.get(n.id));
				return frame === frameOf.get(n.id) ? [n] : [{ ...n, frame }];
			}),
			edges,
		});
		this.selectedNodeIds = this.selectedNodeIds.filter((id) => !removed.has(id));
		this.rebuildTypeCache();
		return true;
	}

	/**
	 * Delete nodes, linking what fed them to what they fed: each link out of
	 * the deleted nodes is traced back through them, along the input of the
	 * same type as the output it leaves (or the first linked input), to a
	 * node that stays. Links that wouldn't be valid are dropped.
	 */
	dissolveNodes(nodeIds: Iterable<string>): boolean {
		if (this.isLocked) return false;
		const doc = this.activeDocument;
		const removed = this.withZonePartners(nodeIds);
		for (const id of removed) {
			if (doc.nodesById.get(id)?.deletable === false) removed.delete(id);
		}
		const links = doc.edges.flatMap((edge) => {
			if (!removed.has(edge.source) || removed.has(edge.target)) return [];
			const upstream = this.upstreamThrough(doc, removed, edge.source, edge.sourceHandle);
			return upstream
				? [
						{
							source: upstream.source,
							sourceHandle: upstream.sourceHandle,
							target: edge.target,
							targetHandle: edge.targetHandle,
						},
					]
				: [];
		});
		if (!this.deleteNodes(removed)) return false;
		for (const link of links) {
			if (this.isValidConnection(link)) this.connect(link);
		}
		return true;
	}

	/** The link that feeds an output of `nodeId` once the `removed` nodes are gone. */
	private upstreamThrough(
		doc: HydratedGraphDocument,
		removed: ReadonlySet<string>,
		nodeId: string,
		handleId: string,
	): GraphEdge | undefined {
		const seen = new Set<string>();
		let node = nodeId;
		let handle = handleId;
		while (!seen.has(node)) {
			seen.add(node);
			const type = this.resolveOutputHandleType(node, handle);
			const hidden = this.hiddenInputs(node);
			const linked = doc.edgesByTarget.get(node) ?? [];
			const incoming = this.resolveNodeInputs(node).flatMap((input) =>
				hidden.has(input.id) ? [] : linked.filter((e) => e.targetHandle === input.id),
			);
			const current = node;
			const fed =
				incoming.find((e) => this.resolveInputType(current, e.targetHandle) === type) ??
				incoming[0];
			if (!fed) return undefined;
			if (!removed.has(fed.source)) return fed;
			node = fed.source;
			handle = fed.sourceHandle;
		}
		return undefined;
	}

	/**
	 * Put nodes' input values, settings, picked types and curves back to
	 * their defaults. What makes a node what it is (its code, sockets, zone
	 * items, label) is kept.
	 */
	resetNodes(nodeIds: Iterable<string>) {
		if (this.isLocked) return;
		const doc = this.activeDocument;
		const patches = new Map<string, NodeData>();
		for (const id of nodeIds) {
			const node = doc.nodesById.get(id);
			if (!node) continue;
			const defaults = this.resolveDescriptor(node).defaultData;
			patches.set(id, {
				...node.data,
				values: structuredClone(defaults.values),
				settings: structuredClone(defaults.settings),
				types: structuredClone(defaults.types),
				curve: structuredClone(defaults.curve),
			});
		}
		if (patches.size === 0) return;
		this.patchNodeData(patches);
		this.rebuildTypeCache();
	}

	/**
	 * Show only the linked sockets of nodes, or all of them again when every
	 * one of them already shows only those.
	 */
	toggleUnlinkedSockets(nodeIds: Iterable<string>) {
		if (this.isLocked) return;
		const nodes = [...nodeIds].flatMap((id) => this.activeDocument.nodesById.get(id) ?? []);
		const hide = nodes.some((n) => n.data.hideUnlinked !== true);
		this.patchNodeData(
			new Map(nodes.map((n) => [n.id, { ...n.data, hideUnlinked: hide || undefined }])),
		);
	}

	/**
	 * Hide the links out of reroutes (see `NodeData.hideLinks`), or show
	 * them again when every one of them already hides them.
	 */
	toggleHiddenLinks(nodeIds: Iterable<string>) {
		if (this.isLocked) return;
		const reroutes = [...nodeIds].flatMap((id) => {
			const node = this.activeDocument.nodesById.get(id);
			return node?.type === "reroute" ? [node] : [];
		});
		const hide = reroutes.some((n) => n.data.hideLinks !== true);
		this.patchNodeData(
			new Map(reroutes.map((n) => [n.id, { ...n.data, hideLinks: hide || undefined }])),
		);
	}

	/** The label a node has unless the user gives it one. */
	defaultNodeLabel(nodeId: string): string {
		const node = this.resolveNode(nodeId);
		return node ? this.resolveDescriptor(node).label : "";
	}

	nodeLabel(nodeId: string): string {
		return this.resolveNode(nodeId)?.data.label ?? this.defaultNodeLabel(nodeId);
	}

	/** Name a node; a blank label (or its default one) gives it back its default. */
	setNodeLabel(nodeId: string, label: string | undefined) {
		const trimmed = label?.trim();
		const custom = trimmed && trimmed !== this.defaultNodeLabel(nodeId) ? trimmed : undefined;
		if (this.resolveNode(nodeId)?.data.label === custom) return;
		this.updateNodeData(nodeId, { label: custom }, { retype: false });
	}

	/**
	 * Route links of the active document through new reroute nodes at the
	 * positions given. Links leaving the same output share one reroute (at
	 * the middle of their positions) which then branches out to their
	 * targets. Returns the reroutes' ids.
	 */
	rerouteEdges(cuts: readonly { edgeId: string; position: Point }[]): string[] {
		if (this.isLocked) return [];
		const doc = this.activeDocument;
		const bySource = new Map<string, { edges: GraphEdge[]; positions: Point[] }>();
		for (const { edgeId, position } of cuts) {
			const edge = doc.edges.find((e) => e.id === edgeId);
			if (!edge) continue;
			const key = `${edge.source}\0${edge.sourceHandle}`;
			const entry = bySource.get(key) ?? { edges: [], positions: [] };
			if (entry.edges.includes(edge)) continue;
			entry.edges.push(edge);
			entry.positions.push(position);
			bySource.set(key, entry);
		}
		if (bySource.size === 0) return [];
		const cut = new Set<string>();
		const reroutes: GraphNode[] = [];
		const links: GraphEdge[] = [];
		for (const { edges, positions } of bySource.values()) {
			const [first] = edges;
			if (!first) continue;
			const id = crypto.randomUUID();
			reroutes.push({
				id,
				type: "reroute",
				data: defaultDataForType("reroute"),
				position: {
					x: positions.reduce((sum, p) => sum + p.x, 0) / positions.length,
					y: positions.reduce((sum, p) => sum + p.y, 0) / positions.length,
				},
			});
			links.push({
				id: crypto.randomUUID(),
				source: first.source,
				sourceHandle: first.sourceHandle,
				target: id,
				targetHandle: "in",
			});
			for (const edge of edges) {
				cut.add(edge.id);
				links.push({
					id: crypto.randomUUID(),
					source: id,
					sourceHandle: "out",
					target: edge.target,
					targetHandle: edge.targetHandle,
				});
			}
		}
		this.setContent(doc, {
			nodes: [...doc.nodes, ...reroutes],
			edges: [...doc.edges.filter((e) => !cut.has(e.id)), ...links],
		});
		this.rebuildTypeCache();
		return reroutes.map((n) => n.id);
	}

	/** The ids given, plus every node the frames among them hold. */
	private withFrameContents(doc: HydratedGraphDocument, nodeIds: Iterable<string>): Set<string> {
		const { frames } = this.frameAnalysis(doc);
		const ids = new Set(nodeIds);
		for (const id of [...ids]) {
			for (const inside of frames.get(id)?.descendants ?? []) ids.add(inside);
		}
		return ids;
	}

	/** The ids given, plus the partner of every zone boundary among them. */
	private withZonePartners(nodeIds: Iterable<string>): Set<string> {
		const ids = [...nodeIds].map((id) => ({ id }));
		return new Set(this.expandDeletion(ids, []).nodes.map((n) => n.id));
	}
}
