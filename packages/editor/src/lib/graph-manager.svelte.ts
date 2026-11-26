import {
	type Asset,
	type Bundle,
	BUNDLE_EXTENSIONS,
	type BundleKind,
	defaultScene,
	defaultScreen,
	defaultSettings,
	describeLoadError,
	err,
	GraphModel,
	type GraphModelState,
	type GraphNode,
	type GraphProject,
	type GroupsFile,
	type HistoryCounts,
	type HydratedGraphDocument,
	type IdSource,
	type LoadError,
	type LoadResult,
	MAX_BUNDLE_BYTES,
	type NodeClipboard,
	type NodeGeometry,
	packBundle,
	parseGroups,
	unpackBundle,
	verifiedFiles,
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

	constructor(project: GraphProject = defaultScene, options?: { ids?: IdSource }) {
		super(project, options);
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
		if (!this.isLocked && this.copy(nodeIds))
			this.apply({ kind: "deleteNodes", args: [nodeIds] });
	}

	/** Paste the clipboard into the active document (see `pasteNodes`). Returns the new ids. */
	paste(position?: { x: number; y: number }): string[] {
		return this.clipboard
			? this.apply({ kind: "pasteNodes", args: [this.clipboard, position] })
			: [];
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

	protected override async measuredGeometry(
		definitionRef: string,
	): Promise<((node: GraphNode) => NodeGeometry | undefined) | undefined> {
		const canvas = this.canvas;
		if (!canvas) return undefined;
		const inView = definitionRef === this.activeDefinitionRef;
		const measured = inView ? undefined : await canvas.measureDocument(definitionRef);
		return (node) => (measured ? measured.get(node.id) : canvas.measure(node));
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

	/**
	 * What went wrong with files the user gave, a sentence each, for them to
	 * read. Replaced, never mutated.
	 */
	fileProblems = $state.raw<readonly string[]>([]);

	private reportFile(name: string, error: LoadError) {
		console.error(`[graph] can't read ${name}`, error);
		this.fileProblems = [...this.fileProblems, `${name}: ${describeLoadError(error)}`];
	}

	private reportAltered(name: string, altered: readonly Asset[]) {
		if (altered.length === 0) return;
		const names = altered.map((asset) => asset.name).join(", ");
		this.fileProblems = [
			...this.fileProblems,
			`${name}: these files aren't what the bundle says they are, so they were left out: ${names}.`,
		];
	}

	private static async readBundle(file: File, kind: BundleKind): Promise<LoadResult<Bundle>> {
		if (file.size > MAX_BUNDLE_BYTES) return err({ kind: "too-large", what: "the bundle" });
		try {
			return unpackBundle(new Uint8Array(await file.arrayBuffer()), kind);
		} catch (error) {
			return err({
				kind: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** Download the project as a bundle and remember it as saved. */
	async save() {
		await this.downloadBundle(
			"project",
			"webGpuNodesProject",
			this.getProjectJson(),
			this.assets,
		);
		this.apply({ kind: "markSaved", args: [] });
	}

	/** Load a project bundle picked by the user; failing leaves the project as it was. */
	async upload(file: File): Promise<boolean> {
		const bundle = await GraphManager.readBundle(file, "project");
		const project = bundle.ok ? this.parseProject(bundle.value.json) : bundle;
		if (!bundle.ok || !project.ok) {
			if (!project.ok) this.reportFile(file.name, project.error);
			return false;
		}
		const assets = project.value.assets ?? [];
		const { files, altered } = await verifiedFiles(bundle.value, assets);
		const loaded = await this.commitProject(project.value);
		if (!loaded.ok) {
			this.reportFile(file.name, loaded.error);
			return false;
		}
		this.assetFiles.reset(
			assets.flatMap((asset): [string, Blob][] => {
				const data = files.get(asset.id);
				return data ? [[asset.id, new Blob([data], { type: asset.mime })]] : [];
			}),
		);
		this.reportAltered(file.name, altered);
		return true;
	}

	/**
	 * Add files as assets, skipping what isn't media; a file already imported
	 * gives its existing asset, finding it its file if it had none. Returns
	 * the assets, in the files' order.
	 */
	async importFiles(files: readonly File[]): Promise<Asset[]> {
		const imported: Asset[] = [];
		for (const file of files) {
			const asset = await describeAsset(file, crypto.randomUUID());
			if (!asset) {
				this.fileProblems = [
					...this.fileProblems,
					`${file.name}: it isn't an image or video this editor can read.`,
				];
				continue;
			}
			const existing = this.assetByHash(asset.hash);
			if (existing) {
				if (!this.assetFiles.get(existing.id)) this.assetFiles.set(existing.id, file);
				imported.push(existing);
				continue;
			}
			this.assetFiles.set(asset.id, file);
			this.apply({ kind: "addAsset", args: [asset] });
			imported.push(asset);
		}
		return imported;
	}

	/** Give an asset another file of the same kind; returns whether it did. */
	async replaceAssetFile(id: string, file: File): Promise<boolean> {
		const current = this.asset(id);
		const asset = await describeAsset(file, id);
		if (!current || asset?.kind !== current.kind) {
			this.fileProblems = [
				...this.fileProblems,
				`${file.name}: it can't replace this asset, being unreadable or of another kind.`,
			];
			return false;
		}
		this.assetFiles.set(id, file);
		this.apply({ kind: "replaceAsset", args: [{ ...asset, name: current.name }] });
		return true;
	}

	/** Download a group, the user groups it nests and their assets as a groups bundle. */
	async exportGroup(definitionRef: string) {
		const { name, json, assets } = this.exportGroups(definitionRef);
		await this.downloadBundle("groups", name, json, assets);
	}

	/**
	 * Import the groups (and their assets) of groups bundles picked by the
	 * user. A file that can't be read is left out; the others come in together.
	 */
	async importGroupFiles(files: readonly File[]) {
		const bundles: Bundle[] = [];
		const groups: GroupsFile[] = [];
		const names: string[] = [];
		for (const file of files) {
			const bundle = await GraphManager.readBundle(file, "groups");
			const parsed = bundle.ok ? parseGroups(bundle.value.json) : bundle;
			if (!bundle.ok || !parsed.ok) {
				if (!parsed.ok) this.reportFile(file.name, parsed.error);
				continue;
			}
			const { altered } = await verifiedFiles(bundle.value, parsed.value.assets);
			this.reportAltered(file.name, altered);
			names.push(file.name);
			bundles.push(bundle.value);
			groups.push({
				...parsed.value,
				assets: parsed.value.assets.filter((asset) => !altered.includes(asset)),
			});
		}
		if (groups.length === 0) return;

		const result = await this.apply({ kind: "importGroups", args: [groups] });
		if (!result.ok) {
			this.reportFile(names.join(", "), result.error);
			return;
		}
		for (const { asset, source } of result.value.added) {
			const data = bundles[source.bundle]?.files.get(source.path);
			if (data) this.assetFiles.set(asset.id, new Blob([data], { type: asset.mime }));
		}
		const { missing } = result.value;
		if (missing.length > 0) {
			console.warn("[graph] imported groups have missing dependencies:", missing);
			this.fileProblems = [
				...this.fileProblems,
				`${String(missing.length)} imported groups rely on groups that weren't in the bundles.`,
			];
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
