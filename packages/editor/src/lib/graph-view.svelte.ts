import type { Box, GraphEdge, GraphNode, HydratedGraphDocument, Viewport } from "$core";
import { createContext } from "svelte";

import type { DocumentView } from "./document-view";
import {
	centerOf,
	dropTargets,
	type FrameDrag,
	frameAt,
	frameBoxes,
	placeFrames,
	startFrameDrag,
} from "./geometry/frame-boxes";
import { rectOf } from "./geometry/node-boxes";
import type { GraphManager } from "./graph-manager.svelte";

const NO_PATH: string[] = [];

/**
 * One graph area's view of the project: the document its path leads to,
 * edited through the model. Reads follow the area's own path, so areas show
 * different documents (or one group entered through different instances)
 * side by side; commands act on the active area, which this one becomes
 * whenever it's used.
 */
export class GraphView implements DocumentView {
	/** Kept while the area's path is the same array, so nodes reading it don't redraw. */
	readonly path: string[];
	readonly document: HydratedGraphDocument;
	readonly definitionRef: string;
	readonly locked: boolean;

	/**
	 * Frames drawn where they were when a drag began, by id: where the drag
	 * ends decides what they hold, not how they'd grow along with it.
	 */
	frozenFrames = $state.raw<ReadonlyMap<string, Box> | null>(null);
	/** The frame a drag would drop its nodes in. */
	dropFrame = $state<string | null>(null);

	/** Where each frame of the document is drawn, by id. */
	readonly frameBoxes: ReadonlyMap<string, Box>;
	/** The document's nodes, each frame's header at the top of its box. */
	private readonly placedNodes: GraphNode[];

	constructor(
		private graph: GraphManager,
		readonly areaId: string,
	) {
		this.path = $derived(graph.graphArea(areaId)?.editor.path ?? NO_PATH);
		this.document = $derived(graph.documentAt(this.path));
		this.definitionRef = $derived(graph.definitionRefAt(this.path));
		this.locked = $derived(graph.isLockedAt(this.path));
		this.frameBoxes = $derived.by(() => {
			const doc = this.document;
			const boxes = frameBoxes(doc, graph.frameAnalysis(doc), graph.zoneAnalysis(doc), (id) =>
				graph.nodeLabel(id),
			);
			const frozen = this.frozenFrames;
			if (!frozen) return boxes;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived, never mutated
			return new Map([...boxes].map(([id, box]) => [id, frozen.get(id) ?? box]));
		});
		this.placedNodes = $derived(placeFrames(this.document.nodes, this.frameBoxes));
	}

	// ── Dragging in and out of frames ───────────────────────────────────────
	// A dragged frame takes what it holds along. Other frames stay as they
	// were until the drop, which puts each node dragged in the innermost
	// frame it's dropped on (or in none).

	private drag: FrameDrag | null = null;

	startDrag(nodeIds: readonly string[]) {
		this.activate();
		const drag = startFrameDrag(
			this.document,
			this.graph.frameAnalysis(this.document),
			nodeIds,
		);
		this.drag = drag;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced, never mutated
		this.frozenFrames = new Map([...this.frameBoxes].filter(([id]) => !drag.moving.has(id)));
	}

	/** Follow the node `anchorId` of the drag, now at `position`. */
	moveDrag(anchorId: string, position: { x: number; y: number }) {
		const drag = this.drag;
		const start = drag?.from.get(anchorId);
		if (!drag || !start) return;
		if (drag.inside.size > 0) {
			this.graph.moveNodes(drag.inside, { x: position.x - start.x, y: position.y - start.y });
		}
		const anchor = this.document.nodesById.get(anchorId);
		const frames = this.graph.frameAnalysis(this.document);
		this.dropFrame = anchor
			? frameAt(this.frameBoxes, frames, centerOf(rectOf(anchor)), drag.moving)
			: null;
	}

	endDrag() {
		const drag = this.drag;
		if (!drag) return;
		this.dropInFrames([...drag.from.keys()], drag.moving);
		this.drag = null;
		this.frozenFrames = null;
		this.dropFrame = null;
	}

	/** End the drag where it started, leaving every node in its frame. */
	cancelDrag() {
		const drag = this.drag;
		if (!drag) return;
		if (drag.inside.size > 0) this.graph.moveNodes(drag.inside, { x: 0, y: 0 });
		this.drag = null;
		this.frozenFrames = null;
		this.dropFrame = null;
	}

	/** Put nodes in the frames they're on (see `dropTargets`). */
	dropInFrames(
		nodeIds: readonly string[],
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read only
		moving: ReadonlySet<string> = new Set(nodeIds),
	) {
		const frames = this.graph.frameAnalysis(this.document);
		const targets = dropTargets(this.document, frames, this.frameBoxes, nodeIds, moving);
		for (const [target, ids] of targets) this.graph.setNodesFrame(ids, target);
	}

	get pathLabels() {
		return this.graph.pathLabelsAt(this.path);
	}

	get active(): boolean {
		return this.graph.activeArea === this.areaId;
	}

	activate() {
		if (this.active) return;
		this.graph.activeArea = this.areaId;
		// The selection commands act on is this area's (it lives on the nodes).
		this.graph.selectedNodeIds = this.document.nodes.filter((n) => n.selected).map((n) => n.id);
	}

	get selectedNodeIds(): string[] {
		return this.document.nodes.filter((n) => n.selected).map((n) => n.id);
	}

	get selectedEdgeIds(): string[] {
		return this.document.edges.filter((e) => e.selected).map((e) => e.id);
	}

	get nodes(): GraphNode[] {
		return this.placedNodes;
	}

	set nodes(value: GraphNode[]) {
		this.graph.setDocumentNodes(this.definitionRef, value);
	}

	get edges(): GraphEdge[] {
		return this.document.edges;
	}

	set edges(value: GraphEdge[]) {
		this.graph.setDocumentEdges(this.definitionRef, value);
	}

	enterGroup(groupNodeId: string) {
		this.activate();
		this.graph.enterGroup(groupNodeId);
	}

	exitGroup() {
		this.activate();
		this.graph.exitGroup();
	}

	jumpToPath(path: string[]) {
		this.activate();
		this.graph.setAreaPath(this.areaId, path);
	}

	/** The camera the area left its document at, if any. */
	get viewport(): Viewport | undefined {
		return this.graph.graphArea(this.areaId)?.editor.viewport;
	}

	set viewport(viewport: Viewport | undefined) {
		const area = this.graph.graphArea(this.areaId);
		if (area) this.graph.setAreaEditor(this.areaId, { ...area.editor, viewport });
	}
}

export const [getGraphView, setGraphView] = createContext<GraphView>();
