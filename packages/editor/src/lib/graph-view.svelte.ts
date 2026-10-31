import type { GraphEdge, GraphNode, HydratedGraphDocument, Viewport } from "$core";
import { createContext } from "svelte";

import type { DocumentView } from "./document-view";
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

	constructor(
		private graph: GraphManager,
		readonly areaId: string,
	) {
		this.path = $derived(graph.graphArea(areaId)?.editor.path ?? NO_PATH);
		this.document = $derived(graph.documentAt(this.path));
		this.definitionRef = $derived(graph.definitionRefAt(this.path));
		this.locked = $derived(graph.isLockedAt(this.path));
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
		return this.document.nodes;
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
