import {
	type Asset,
	type Bundle,
	BUNDLE_EXTENSIONS,
	type BundleKind,
	defaultScene,
	defaultScreen,
	defaultSettings,
	GraphModel,
	type GraphModelState,
	type GraphNode,
	type GraphProject,
	type HistoryCounts,
	type HydratedGraphDocument,
	type LayoutOptions,
	type NodeClipboard,
	type NodeGeometry,
	packBundle,
	unpackBundle,
} from "$core";
import { getContext, setContext } from "svelte";

import { AssetFiles, describeAsset } from "./assets";
import type { SettingsPage } from "./components/settings/pages";
import { ReactiveGraphDocument } from "./reactive-document.svelte";
import { downloadFile } from "./utils";

/**
 * The editor's graph: `$core`'s `GraphModel` made reactive (its state,
 * documents and history counts are Svelte state), plus what only an
 * interactive editor needs: settings sheets and browser file I/O.
 */
export class GraphManager extends GraphModel {
	readonly assetFiles = new AssetFiles();

	constructor(project: GraphProject = defaultScene) {
		super(project);
	}

	protected override createState(): GraphModelState {
		const state = $state<GraphModelState>({
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map is reassigned, not mutated
			project: { definitions: new Map() },
			settings: defaultSettings(),
			assets: [],
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

	/** The node whose sheet is open, if any. */
	sheetNodeId = $state<string | null>(null);

	/** The page of the settings dialog shown, or null while it's closed. */
	settingsPage = $state<SettingsPage | null>(null);

	/** Open (or toggle closed) a node's sheet. */
	openSheet(nodeId: string) {
		this.sheetNodeId = this.sheetNodeId === nodeId ? null : nodeId;
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

	/** Download a bundle of `kind` holding `json` and the files of `assets`. */
	private async downloadBundle(
		kind: BundleKind,
		name: string,
		json: string,
		assets: readonly Asset[],
	) {
		const files: [string, Uint8Array][] = [];
		for (const asset of assets) {
			const file = this.assetFiles.get(asset.id);
			if (file) files.push([asset.file, new Uint8Array(await file.arrayBuffer())]);
		}
		downloadFile(
			`${name}${BUNDLE_EXTENSIONS[kind]}`,
			new Blob([packBundle({ kind, json, files })], { type: "application/zip" }),
		);
	}

	/** The files of `assets` found in a bundle, by asset id. */
	private static filesIn(bundle: Bundle, assets: readonly Asset[]): [string, Blob][] {
		return assets.flatMap((asset): [string, Blob][] => {
			const data = bundle.files.get(asset.file);
			return data ? [[asset.id, new Blob([data], { type: asset.mime })]] : [];
		});
	}

	/** Download the project as a bundle and remember it as saved. */
	async save() {
		await this.downloadBundle(
			"project",
			"webGpuNodesProject",
			this.getProjectJson(),
			this.assets,
		);
		this.markSaved();
	}

	/** Load a project bundle picked by the user. */
	async upload(file: File): Promise<boolean> {
		try {
			const bundle = unpackBundle(new Uint8Array(await file.arrayBuffer()), "project");
			if (!(await this.loadFromString(bundle.json))) return false;
			this.assetFiles.reset(GraphManager.filesIn(bundle, this.assets));
			return true;
		} catch (err) {
			console.error("[graph] failed to read uploaded file", err);
			return false;
		}
	}

	/**
	 * Add files as assets, skipping what isn't media; a file already imported
	 * gives its existing asset. Returns the assets, in the files' order.
	 */
	async importFiles(files: readonly File[]): Promise<Asset[]> {
		const imported: Asset[] = [];
		for (const file of files) {
			const asset = await describeAsset(file, crypto.randomUUID());
			if (!asset) continue;
			const existing = this.assetByHash(asset.hash);
			if (existing) {
				imported.push(existing);
				continue;
			}
			this.assetFiles.set(asset.id, file);
			this.addAsset(asset);
			imported.push(asset);
		}
		return imported;
	}

	/** Give an asset another file of the same kind; returns whether it did. */
	async replaceAssetFile(id: string, file: File): Promise<boolean> {
		const current = this.asset(id);
		const asset = await describeAsset(file, id);
		if (!current || asset?.kind !== current.kind) return false;
		this.assetFiles.set(id, file);
		this.replaceAsset({ ...asset, name: current.name });
		return true;
	}

	/** Download a group, the user groups it nests and their assets as a groups bundle. */
	async exportGroup(definitionRef: string) {
		const { name, json, assets } = this.exportGroups(definitionRef);
		await this.downloadBundle("groups", name, json, assets);
	}

	/** Import the groups (and their assets) of groups bundles picked by the user. */
	async importGroupFiles(files: readonly File[]) {
		const bundles: Bundle[] = [];
		for (const file of files) {
			try {
				bundles.push(unpackBundle(new Uint8Array(await file.arrayBuffer()), "groups"));
			} catch (err) {
				console.error(`[graph] can't read ${file.name}`, err);
			}
		}
		const result = await this.importGroups(bundles.map((b) => JSON.parse(b.json) as unknown));
		for (const bundle of bundles) {
			for (const [id, file] of GraphManager.filesIn(bundle, result.added)) {
				this.assetFiles.set(id, file);
			}
		}
		return result;
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
