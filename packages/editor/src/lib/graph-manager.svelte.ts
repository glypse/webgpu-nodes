import {
	defaultScene,
	GraphModel,
	type GraphModelState,
	type GraphProject,
	type HistoryCounts,
	type HydratedGraphDocument,
} from "$core";
import { getContext, setContext } from "svelte";

import { ReactiveGraphDocument } from "./reactive-document.svelte";

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
			path: [],
			selectedNodeIds: [],
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
			typeCache: new Map(),
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

	// ── Files ───────────────────────────────────────────────────────────────

	/** Download the project as JSON and remember it as saved. */
	save() {
		downloadFile("webGpuNodesProject.json", this.getProjectJson());
		this.markSaved();
	}

	/** Load a project from a JSON file picked by the user. */
	async upload(file: File): Promise<boolean> {
		try {
			return this.loadFromString(await file.text());
		} catch (err) {
			console.error("[graph] failed to read uploaded file", err);
			return false;
		}
	}

	/** Download a group and the user groups it nests, one JSON file each. */
	exportGroup(definitionRef: string) {
		for (const { filename, contents } of this.exportGroupFiles(definitionRef)) {
			downloadFile(filename, contents);
		}
	}
}

/** Trigger a browser download of a JSON file. */
function downloadFile(filename: string, contents: string) {
	const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

// ── Context helpers ──────────────────────────────────────────────────────────

const KEY = Symbol("graph-manager");

export function setGraphManager(m: GraphManager) {
	setContext(KEY, m);
}

export function getGraphManager(): GraphManager {
	return getContext<GraphManager>(KEY);
}
