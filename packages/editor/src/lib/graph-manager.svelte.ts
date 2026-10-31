import {
	defaultScene,
	defaultScreen,
	defaultSettings,
	GraphModel,
	type GraphModelState,
	type GraphProject,
	type HistoryCounts,
	type GraphNode,
	type HydratedGraphDocument,
	type LayoutOptions,
	type NodeClipboard,
	type NodeGeometry,
} from "$core";
import { getContext, setContext } from "svelte";

import type { SettingsPage } from "./components/settings/pages";
import { ReactiveGraphDocument } from "./reactive-document.svelte";
import { downloadFile } from "./utils";

function jsonBlob(contents: string): Blob {
	return new Blob([contents], { type: "application/json" });
}

/**
 * The editor's graph: `$core`'s `GraphModel` made reactive (its state,
 * documents and history counts are Svelte state), plus what only an
 * interactive editor needs: settings sheets and browser file I/O.
 */
export class GraphManager extends GraphModel {
	constructor(project: GraphProject = defaultScene) {
		super(project);
	}

	protected override createState(): GraphModelState {
		const state = $state<GraphModelState>({
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map is reassigned, not mutated
			project: { definitions: new Map() },
			settings: defaultSettings(),
			screen: defaultScreen(),
			activeArea: null,
			selectedNodeIds: [],
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
			typeCaches: new Map(),
		});
		return state;
	}

	protected override createDocument(): HydratedGraphDocument {
		return new ReactiveGraphDocument();
	}

	protected override createHistoryCounts(): HistoryCounts {
		const counts = $state({ undo: 0, redo: 0 });
		return counts;
	}

	// ── Sheets ──────────────────────────────────────────────────────────────

	/**
	 * Group configuration sheet state. Opened via the "n" key (see GraphContent)
	 * or the faders button on group / group-input / group-output nodes (see NodeShell).
	 * `sheetGroupId` is the id of the group node *instance* whose definition is being edited.
	 */
	sheetOpen = $state(false);
	sheetGroupId = $state<string | null>(null);

	/**
	 * Repeat zone settings sheet: the zone (Repeat Input node id) being edited.
	 */
	zoneSheetId = $state<string | null>(null);

	/** The page of the settings dialog shown, or null while it's closed. */
	settingsPage = $state<SettingsPage | null>(null);

	/** Open (or toggle closed) the settings sheet of the zone a boundary node belongs to. */
	openZoneSheet(boundaryNodeId: string) {
		const zoneId = this.activeZones.zoneOfBoundary.get(boundaryNodeId) ?? null;
		this.zoneSheetId = this.zoneSheetId === zoneId ? null : zoneId;
	}

	/** Open (or toggle closed) the group configuration sheet for a group node instance. */
	openGroupSheet(targetNodeId: string) {
		if (this.sheetOpen && this.sheetGroupId === targetNodeId) {
			this.sheetOpen = false;
		} else {
			this.sheetGroupId = targetNodeId;
			this.sheetOpen = true;
		}
	}

	// ── Clipboard ───────────────────────────────────────────────────────────

	/** Nodes last copied or cut, shared by every graph area. */
	clipboard = $state.raw<NodeClipboard | null>(null);

	copy(nodeIds: Iterable<string>): boolean {
		const clipboard = this.copyNodes(nodeIds);
		if (clipboard) this.clipboard = clipboard;
		return clipboard !== undefined;
	}

	cut(nodeIds: string[]) {
		if (!this.isLocked && this.copy(nodeIds)) this.deleteNodes(nodeIds);
	}

	/** Paste the clipboard into the active document (see `pasteNodes`). Returns the new ids. */
	paste(position?: { x: number; y: number }): string[] {
		return this.clipboard ? this.pasteNodes(this.clipboard, position) : [];
	}

	// ── Layout ──────────────────────────────────────────────────────────────

	/** The canvases of the graph areas mounted, by area id. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- registered by canvases as they mount, read on demand
	readonly canvases = new Map<string, GraphCanvas>();

	/**
	 * The active graph area's canvas, while one is mounted: it measures nodes
	 * as drawn, for layouts to use.
	 */
	get canvas(): GraphCanvas | null {
		return (this.activeArea === null ? undefined : this.canvases.get(this.activeArea)) ?? null;
	}

	override async layoutDocument(
		definitionRef: string = this.activeDefinitionRef,
		options: LayoutOptions = {},
	): Promise<boolean> {
		const canvas = this.canvas;
		if (!canvas) return super.layoutDocument(definitionRef, options);
		const inView = definitionRef === this.activeDefinitionRef;
		const measured = inView ? undefined : await canvas.measureDocument(definitionRef);
		return super.layoutDocument(definitionRef, {
			measure: (_ref, node) => (measured ? measured.get(node.id) : canvas.measure(node)),
			...options,
		});
	}

	// ── Files ───────────────────────────────────────────────────────────────

	/** Download the project as JSON and remember it as saved. */
	save() {
		downloadFile("webGpuNodesProject.json", jsonBlob(this.getProjectJson()));
		this.markSaved();
	}

	/** Load a project from a JSON file picked by the user. */
	async upload(file: File): Promise<boolean> {
		try {
			return await this.loadFromString(await file.text());
		} catch (err) {
			console.error("[graph] failed to read uploaded file", err);
			return false;
		}
	}

	/** Download a group and the user groups it nests, one JSON file each. */
	exportGroup(definitionRef: string) {
		for (const { filename, contents } of this.exportGroupFiles(definitionRef)) {
			downloadFile(filename, jsonBlob(contents));
		}
	}
}

export type GraphCanvas = {
	/** A node of the document in view. */
	measure(node: GraphNode): NodeGeometry | undefined;
	/** Every node of a document, drawn out of sight for the purpose. */
	measureDocument(definitionRef: string): Promise<Map<string, NodeGeometry>>;
	/** Frame every node of the document in view. */
	fitView(): Promise<void>;
};

// ── Context helpers ──────────────────────────────────────────────────────────

const KEY = Symbol("graph-manager");

export function setGraphManager(m: GraphManager) {
	setContext(KEY, m);
}

export function getGraphManager(): GraphManager {
	return getContext<GraphManager>(KEY);
}
