import * as v from "valibot";

import { convertColorMode } from "../color";
import type { CurvePoint } from "../curve";
import { MATCH, isCaseHandle } from "../enums";
import {
	ARCHIVED_VERSIONS_ENABLED,
	loadArchivedVersion,
	parseLibraryRef,
	standardLibrary,
} from "../library";
import { nodeRegistry } from "../nodes/registry";
import {
	type Area,
	type EditorState,
	type GraphEditorState,
	type Screen,
	defaultScreen,
	setAreaEditor,
} from "../screen/screen";
import {
	type InputValue,
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeOutputDef,
	type NodeColorWidget,
	type TypeBindings,
	type WgslType,
	enumValue,
	inputFamilyKey,
	isConnectionCompatible,
} from "../types";
import { type ResolvedNodeTypes, TypeResolver, bindingsKey } from "../types/resolver";
import { type ZoneAnalysis, analyzeZones } from "../zones";
import {
	type GraphDocument,
	type GraphDocumentNode,
	type GraphEdge,
	type GraphNode,
	type GraphProject,
	type HydratedGraphDocument,
	type HydratedGraphProject,
	ROOT_ID,
	type StandardLibraryEntry,
	createPlainDocument,
} from "./document";
import { type HistoryCounts } from "./history";
import {
	hydrateDocument,
	hydrateProject,
	indexDocument,
	normaliseDocument,
	resolveDescriptor,
} from "./hydrate";
import { ProjectSettingsSchema, type ProjectSettings, defaultSettings } from "./settings";
import { readComponent } from "./values";

export type ResolvedTypes = ResolvedNodeTypes;

export type GraphModelState = {
	project: HydratedGraphProject;
	settings: ProjectSettings;
	/** The editor panels; graph areas hold the paths documents are viewed at. */
	screen: Screen;
	/** The graph area commands act on (the one last used), if any. */
	activeArea: string | null;
	selectedNodeIds: string[];
	/**
	 * Resolved types by node id, per path viewed (`pathKey`), the root's
	 * always among them: a group's nodes take the types its instance binds.
	 */
	typeCaches: Map<string, Map<string, ResolvedTypes>>;
};

/** The key of a path in `GraphModelState.typeCaches`. */
export function pathKey(path: readonly string[]): string {
	return path.join("/");
}

export function emptyProject(): GraphProject {
	return { definitions: { [ROOT_ID]: { nodes: [], edges: [] } } };
}

/**
 * The model's state and the queries everything else builds on: documents and
 * the standard library, navigation through groups, and resolved types.
 */
export abstract class GraphModelBase {
	protected readonly state: GraphModelState = this.createState();

	/** Read-only standard library entries for browsing. */
	readonly library: readonly StandardLibraryEntry[] = standardLibrary;

	/** Centralised type resolver — single source of truth for all type resolution. */
	typeResolver!: TypeResolver;

	// ── Factories for front ends ────────────────────────────────────────────────

	/** The model's mutable state; override to return a reactive object. */
	protected createState(): GraphModelState {
		return {
			project: { definitions: new Map() },
			settings: defaultSettings(),
			screen: defaultScreen(),
			activeArea: null,
			selectedNodeIds: [],
			typeCaches: new Map(),
		};
	}

	/** A new in-memory document; override to return a reactive one. */
	protected createDocument(): HydratedGraphDocument {
		return createPlainDocument();
	}

	/** Undo / redo stack sizes; override to return a reactive object. */
	protected createHistoryCounts(): HistoryCounts {
		return { undo: 0, redo: 0 };
	}

	// ── State ───────────────────────────────────────────────────────────────────

	/** The entire project tree. */
	get project(): HydratedGraphProject {
		return this.state.project;
	}

	set project(value: HydratedGraphProject) {
		this.state.project = value;
	}

	/** How the project renders. Replaced, never mutated (see `updateSettings`). */
	get settings(): ProjectSettings {
		return this.state.settings;
	}

	/** Change the settings; invalid ones (e.g. a size out of range) are ignored. */
	updateSettings(settings: ProjectSettings): boolean {
		const parsed = v.safeParse(ProjectSettingsSchema, settings);
		if (!parsed.success) return false;
		this.state.settings = parsed.output;
		return true;
	}

	/** The editor panels. Replaced, never mutated (see `setScreen`). */
	get screen(): Screen {
		return this.state.screen;
	}

	/**
	 * Lay the panels out anew. Graph areas' paths that no longer lead to a
	 * document are cut back to what still exists.
	 */
	setScreen(screen: Screen) {
		this.state.screen = {
			areas: screen.areas.map((a) => {
				if (a.editor.type !== "graph") return a;
				const path = this.validPath(a.editor.path);
				// Unchanged areas stay the same objects, so views of them don't redraw.
				return path.length === a.editor.path.length
					? a
					: { ...a, editor: { ...a.editor, path } };
			}),
		};
		const active = this.state.activeArea;
		if (active === null || this.graphArea(active) === undefined) {
			this.state.activeArea = this.graphAreas()[0]?.id ?? null;
		}
		this.refreshViewTypes();
	}

	/** The graph areas, in screen order. */
	graphAreas(): (Area & { editor: GraphEditorState })[] {
		return this.screen.areas.filter(
			(a): a is Area & { editor: GraphEditorState } => a.editor.type === "graph",
		);
	}

	graphArea(id: string): (Area & { editor: GraphEditorState }) | undefined {
		return this.graphAreas().find((a) => a.id === id);
	}

	/** The graph area commands act on; null when the screen has none. */
	get activeArea(): string | null {
		return this.state.activeArea;
	}

	set activeArea(id: string | null) {
		if (id === this.state.activeArea || (id !== null && !this.graphArea(id))) return;
		this.state.activeArea = id;
		this.refreshViewTypes();
	}

	/** Change an area's editor (its type, or a graph area's camera). */
	setAreaEditor(id: string, editor: EditorState) {
		this.setScreen(setAreaEditor(this.screen, id, editor));
	}

	/** Set the path a graph area views. */
	setAreaPath(id: string, path: string[]) {
		const area = this.graphArea(id);
		if (!area) return;
		this.state.screen = setAreaEditor(this.screen, id, { ...area.editor, path });
		this.refreshViewTypes();
	}

	/**
	 * Breadcrumb path of group-node ids from root down to the subgraph the
	 * active graph area views: [] for the root, ["node-7"] inside node-7's
	 * group, ["node-7", "node-12"] two levels deep. Always the root without
	 * a graph area.
	 */
	get path(): string[] {
		const id = this.activeArea;
		return (id === null ? undefined : this.graphArea(id)?.editor.path) ?? [];
	}

	set path(value: string[]) {
		if (this.activeArea !== null) this.setAreaPath(this.activeArea, value);
	}

	/** The longest start of `path` that still walks through group nodes. */
	protected validPath(path: readonly string[]): string[] {
		const valid: string[] = [];
		for (const { nodeId } of this.walkPath(path)) valid.push(nodeId);
		return valid;
	}

	/** Currently selected node IDs (grouping acts on them, ungrouping selects its result). */
	get selectedNodeIds(): string[] {
		return this.state.selectedNodeIds;
	}

	set selectedNodeIds(value: string[]) {
		this.state.selectedNodeIds = value;
	}

	/**
	 * Resolved types by node id, as seen from `path` (the active one by
	 * default). Replaced (never mutated) after graph mutations.
	 */
	typesAt(path: readonly string[] = this.path): Map<string, ResolvedTypes> {
		return (
			this.state.typeCaches.get(pathKey(path)) ??
			this.state.typeCaches.get("") ??
			new Map<string, ResolvedTypes>()
		);
	}

	/** Resolved types as seen from the active path. */
	get typeCache(): Map<string, ResolvedTypes> {
		return this.typesAt();
	}

	/** Shortcut for the root document. Always exists after construction. */
	get root(): HydratedGraphDocument {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ROOT_ID is always present
		return this.project.definitions.get(ROOT_ID)!;
	}

	// ── Documents ───────────────────────────────────────────────────────────────

	/**
	 * Replace the whole project: hydrate it, register the standard library
	 * definitions next to it (so group nodes can reference them), and rebuild
	 * the type resolver and type cache for the new definitions.
	 */
	protected setProject(project: GraphProject, { keepScreen = false } = {}) {
		this.project = hydrateProject(project, () => this.createDocument());
		this.state.settings = project.settings ?? defaultSettings();
		const screen = keepScreen ? this.screen : (project.layout ?? defaultScreen());
		for (const entry of this.library) this.registerLibraryEntry(entry.ref, entry);
		this.registerLibraryRefs();
		this.typeResolver = new TypeResolver(
			(n) => this.resolveDescriptor(n),
			() => this.project.definitions,
			(id) => this.getIncomingEdges(id),
		);
		this.setScreen(screen);
		this.rebuildTypeCache();
	}

	protected hydrate(document: GraphDocument): HydratedGraphDocument {
		return hydrateDocument(document, () => this.createDocument());
	}

	/** Add (or replace) definitions, reassigning the map so front ends notice. */
	protected setDefinitions(entries: Iterable<[string, HydratedGraphDocument]>) {
		this.project.definitions = new Map([...this.project.definitions, ...entries]);
	}

	/**
	 * Remove definitions; leaves the breadcrumb for the root if it went
	 * through one of them.
	 */
	protected removeDefinitions(refs: readonly string[]) {
		const removed = new Set(refs);
		this.project.definitions = new Map(
			[...this.project.definitions].filter(([key]) => !removed.has(key)),
		);
		this.setScreen(this.screen);
	}

	protected setContent(
		doc: HydratedGraphDocument,
		content: { nodes?: GraphNode[]; edges?: GraphEdge[] },
	) {
		if (content.nodes) doc.nodes = content.nodes;
		if (content.edges) doc.edges = content.edges;
		indexDocument(doc);
	}

	// ── Lookups and navigation ──────────────────────────────────────────────────

	/**
	 * Look up any node by ID across all documents in the project.
	 * Used as the `resolveNode` callback for the TypeResolver.
	 */
	resolveNode(nodeId: string): GraphNode | undefined {
		for (const def of this.project.definitions.values()) {
			const n = def.nodesById.get(nodeId);
			if (n) return n;
		}
		return undefined;
	}

	/** The document holding a node, anywhere in the project. */
	protected documentOf(nodeId: string): HydratedGraphDocument | undefined {
		for (const doc of this.project.definitions.values()) {
			if (doc.nodesById.has(nodeId)) return doc;
		}
		return undefined;
	}

	/**
	 * Find all edges targeting a node across the entire project.
	 * Used by TypeResolver for recursive type inference.
	 */
	protected getIncomingEdges(nodeId: string): GraphEdge[] {
		for (const def of this.project.definitions.values()) {
			const edges = def.edgesByTarget.get(nodeId) ?? [];
			if (edges.length > 0) return edges;
		}
		return [];
	}

	/**
	 * Walk the breadcrumb path, yielding (node, definition) at each step.
	 * Stops early if a step is invalid (missing node or definition).
	 */
	protected *walkPath(path: readonly string[] = this.path): Generator<{
		node: GraphNode;
		group: NonNullable<GraphNode["group"]>;
		definition: HydratedGraphDocument;
		nodeId: string;
	}> {
		let current: HydratedGraphDocument = this.root;
		for (const nodeId of path) {
			const node = current.nodesById.get(nodeId);
			if (!node?.group) return;
			const definition = this.project.definitions.get(node.group.definitionRef);
			if (!definition) return;
			yield { node, group: node.group, definition, nodeId };
			current = definition;
		}
	}

	/** The document `path` leads to; the root when it leads nowhere. */
	documentAt(path: readonly string[]): HydratedGraphDocument {
		let current: HydratedGraphDocument = this.root;
		let steps = 0;
		for (const { definition } of this.walkPath(path)) {
			current = definition;
			steps++;
		}
		return steps === path.length ? current : this.root;
	}

	/** The key in `project.definitions` of the document `path` leads to. */
	definitionRefAt(path: readonly string[]): string {
		let ref = ROOT_ID;
		let steps = 0;
		for (const { group } of this.walkPath(path)) {
			ref = group.definitionRef;
			steps++;
		}
		return steps === path.length ? ref : ROOT_ID;
	}

	/** The document the active graph area views. */
	get activeDocument(): HydratedGraphDocument {
		return this.documentAt(this.path);
	}

	/** The key of the active document in `project.definitions`. */
	get activeDefinitionRef(): string {
		return this.definitionRefAt(this.path);
	}

	resolveDescriptor(node: GraphNode): NodeDescriptor {
		return resolveDescriptor(node, this.project.definitions);
	}

	// ── Zones ───────────────────────────────────────────────────────────────────

	protected zoneCache = new WeakMap<
		HydratedGraphDocument,
		{ nodes: GraphNode[]; edges: GraphEdge[]; analysis: ZoneAnalysis }
	>();

	/**
	 * Zone membership / invalid links of a document. Derived from its nodes and
	 * edges (the single source of truth) and memoised on their identity.
	 */
	zoneAnalysis(doc: HydratedGraphDocument): ZoneAnalysis {
		const cached = this.zoneCache.get(doc);
		if (cached?.nodes === doc.nodes && cached.edges === doc.edges) return cached.analysis;
		const analysis = analyzeZones(doc.nodes, doc.edges);
		this.zoneCache.set(doc, { nodes: doc.nodes, edges: doc.edges, analysis });
		return analysis;
	}

	/** Zone analysis of the currently-viewed document. */
	get activeZones(): ZoneAnalysis {
		return this.zoneAnalysis(this.activeDocument);
	}

	protected isTypeCompatible(
		sourceNode: GraphNode,
		sourceHandle: string,
		targetNode: GraphNode,
		targetHandle: string,
	): boolean {
		const sourceType = this.typeResolver.inferHandleType(
			{ source: sourceNode.id, sourceHandle, target: "", targetHandle: "", id: "" },
			(id) => this.resolveNode(id),
		);

		const targetDescriptor = this.resolveDescriptor(targetNode);

		// For nodes with resolveInputs, validate against active inputs only
		if (targetDescriptor.resolveInputs && targetDescriptor.typeFamily) {
			const activeInputs = this.resolveNodeInputs(targetNode.id);
			const targetInputDef = activeInputs.find((i) => i.id === targetHandle);
			if (!targetInputDef) return false;
			return isConnectionCompatible(sourceType, targetInputDef.types[0] ?? "f32");
		}

		const targetInputDef = targetDescriptor.inputs.find((i) => i.id === targetHandle);
		if (!targetInputDef) return false;

		// If the target has a node-wide override, validate against that specific type
		const overrideType = targetNode.data.types?.[inputFamilyKey(targetInputDef)];
		if (overrideType) return isConnectionCompatible(sourceType, overrideType);

		// Valid if the source can be converted to any type within the family
		return targetInputDef.types.some((t) => isConnectionCompatible(sourceType, t));
	}

	/** Replace the data of some nodes, in whichever documents hold them (reactively). */
	protected patchNodeData(patches: Map<string, NodeData>) {
		const docs = new Set(
			[...patches.keys()]
				.map((id) => this.documentOf(id))
				.filter((doc): doc is HydratedGraphDocument => doc !== undefined),
		);
		for (const doc of docs) {
			doc.nodes = doc.nodes.map((n) => {
				const data = patches.get(n.id);
				return data ? { ...n, data } : n;
			});
			indexDocument(doc);
		}
	}

	/** Whether the subgraph `path` leads to (or any of its ancestors) is locked. */
	isLockedAt(path: readonly string[]): boolean {
		for (const { group } of this.walkPath(path)) {
			if (group.locked) return true;
		}
		return false;
	}

	/** Whether the active subgraph (or any of its ancestors) is locked. */
	get isLocked(): boolean {
		return this.isLockedAt(this.path);
	}

	/** Labels for each segment of the active breadcrumb path. */
	get pathLabels(): { id: string; label: string; locked: boolean }[] {
		return this.pathLabelsAt(this.path);
	}

	/** Labels for each segment of a breadcrumb path, suitable for rendering. */
	pathLabelsAt(path: readonly string[]): { id: string; label: string; locked: boolean }[] {
		const labels: { id: string; label: string; locked: boolean }[] = [];
		for (const { node, definition, nodeId } of this.walkPath(path)) {
			if (node.type === "node-group") {
				labels.push({
					id: nodeId,
					label: node.data.label ?? definition.label ?? "Group",
					locked: node.group?.locked ?? false,
				});
			} else {
				const desc = nodeRegistry[node.type ?? ""];
				labels.push({
					id: nodeId,
					label: node.data.label ?? desc?.label ?? node.type ?? "unknown",
					locked: false,
				});
			}
		}
		return labels;
	}

	/**
	 * The document that *contains* the current group node (one level up from the
	 * activeDocument).  Returns the root when at the top level.
	 */
	get parentDocument(): HydratedGraphDocument {
		if (this.path.length === 0) return this.root;
		let current: HydratedGraphDocument = this.root;
		let steps = 0;
		for (const { definition } of this.walkPath()) {
			steps++;
			if (steps >= this.path.length) break;
			current = definition;
		}
		return current;
	}

	/** Push a group node's id onto the breadcrumb path - "enter" it. */
	enterGroup(groupNodeId: string) {
		const node = this.activeDocument.nodesById.get(groupNodeId);
		if (!node?.group) {
			console.warn(`[graph] cannot enter "${groupNodeId}" - not a group node`);
			return;
		}
		this.selectedNodeIds = [];
		this.path = [...this.path, groupNodeId];
	}

	/** Pop one level off the breadcrumb path - "exit" the current group. */
	exitGroup() {
		if (this.path.length === 0) return;
		this.path = this.path.slice(0, -1);
	}

	/**
	 * Jump directly to a specific depth in the breadcrumb (e.g. clicking a breadcrumb
	 * UI element rather than stepping back one at a time).
	 */
	jumpToPath(newPath: string[]) {
		this.path = [...newPath];
	}

	// ── Standard library versions ───────────────────────────────────────────────

	/** Older standard-library versions fetched so far, by ref. */
	protected readonly archivedLibrary = new Map<string, StandardLibraryEntry>();

	protected archivedVersionsEnabled = ARCHIVED_VERSIONS_ENABLED;

	protected loadArchivedVersion = loadArchivedVersion;

	/** Check if a definitionRef belongs to the standard library (any version). */
	protected isStandardLibrary(definitionRef: string): boolean {
		const id = parseLibraryRef(definitionRef)?.id;
		return this.library.some((e) => e.id === id);
	}

	private registerLibraryEntry(ref: string, entry: StandardLibraryEntry) {
		const def = normaliseDocument(entry.definition);
		def.label = entry.label;
		def.locked = true;
		const doc = hydrateDocument(def, () => this.createDocument());
		// Only the library's own definition gets it: a clone computes
		// whatever its user makes it compute, which the widget can't know.
		if (entry.widget) doc.widget = entry.widget;
		this.project.definitions.set(ref, doc);
	}

	/** Standard-library refs the group nodes of `documents` point at. */
	private libraryRefsIn(
		documents: Iterable<{ nodes: readonly Pick<GraphDocumentNode, "group">[] }>,
	): Set<string> {
		const refs = new Set<string>();
		for (const doc of documents) {
			for (const node of doc.nodes) {
				const ref = node.group?.definitionRef;
				if (ref && this.isStandardLibrary(ref)) refs.add(ref);
			}
		}
		return refs;
	}

	/**
	 * Give every standard-library version the project references a
	 * definition: the archived one if it was fetched, the latest otherwise.
	 */
	protected registerLibraryRefs() {
		for (let missing = this.missingLibraryRefs(); missing.length > 0;) {
			for (const ref of missing) {
				const id = parseLibraryRef(ref)?.id;
				const entry =
					this.archivedLibrary.get(ref) ?? this.library.find((e) => e.id === id);
				if (entry) this.registerLibraryEntry(ref, entry);
			}
			missing = this.missingLibraryRefs();
		}
	}

	private missingLibraryRefs(): string[] {
		const refs = this.libraryRefsIn(this.project.definitions.values());
		return [...refs].filter((ref) => !this.project.definitions.has(ref));
	}

	/**
	 * Fetch the archived standard-library versions `documents` reference
	 * (and those they nest), so `registerLibraryRefs` can use them.
	 */
	protected async fetchArchivedVersions(documents: Iterable<GraphDocument>): Promise<void> {
		if (!this.archivedVersionsEnabled) return;
		const latest = new Set(this.library.map((e) => e.ref));
		let pending = [...this.libraryRefsIn(documents)];
		while (pending.length > 0) {
			const fetched = await Promise.all(
				pending
					.filter((ref) => !latest.has(ref) && !this.archivedLibrary.has(ref))
					.map(async (ref) => [ref, await this.loadArchivedVersion(ref)] as const),
			);
			const loaded: GraphDocument[] = [];
			for (const [ref, entry] of fetched) {
				if (!entry) {
					console.warn(`[graph] standard-library version "${ref}" is not archived`);
					continue;
				}
				this.archivedLibrary.set(ref, entry);
				loaded.push(entry.definition);
			}
			pending = [...this.libraryRefsIn(loaded)];
		}
	}

	/**
	 * For a group node using a standard-library version other than the
	 * latest: its label, and whether that version itself was loaded (or the
	 * latest stands in for it). Undefined otherwise.
	 */
	outdatedLibraryVersion(nodeId: string): { label: string; archived: boolean } | undefined {
		const ref = this.resolveNode(nodeId)?.group?.definitionRef;
		const id = ref ? parseLibraryRef(ref)?.id : undefined;
		const latest = this.library.find((e) => e.id === id);
		if (!ref || !latest || latest.ref === ref) return undefined;
		return { label: latest.label, archived: this.archivedLibrary.has(ref) };
	}

	// ── Types ───────────────────────────────────────────────────────────────────

	/**
	 * Resolve the effective type for an input handle on a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveInputType(nodeId: string, inputId: string, path?: readonly string[]): WgslType {
		const node = this.resolveNode(nodeId);
		if (!node) return "f32";

		const descriptor = this.resolveDescriptor(node);
		const inputDef = descriptor.inputs.find((i) => i.id === inputId);
		if (!inputDef) return "f32";

		const result = this.typesOf(node, path);
		return result.inputTypes[inputId] ?? inputDef.types[0] ?? "f32";
	}

	/**
	 * A node's types as seen from `path` (the active one by default): cached,
	 * or computed on the fly for a node not cached yet.
	 */
	private typesOf(node: GraphNode, path: readonly string[] = this.path): ResolvedTypes {
		const cached = this.typesAt(path).get(node.id);
		if (cached) return cached;
		return this.typeResolver.resolveNodeTypes(
			node,
			this.getIncomingEdges(node.id),
			this.lookup,
			this.viewBindings(node.id, path),
		);
	}

	/**
	 * Resolve the output type for a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveNodeOutputType(nodeId: string, path?: readonly string[]): WgslType {
		const node = this.resolveNode(nodeId);
		return node ? this.typesOf(node, path).outputType : "f32";
	}

	/**
	 * The type an input would get from its links alone, ignoring the type the
	 * user forced on the node.
	 */
	resolveInferredInputType(nodeId: string, inputId: string, path?: readonly string[]): WgslType {
		const forced = this.resolveInputType(nodeId, inputId, path); // also tracks the type cache
		const node = this.resolveNode(nodeId);
		if (!node?.data.types) return forced;
		const data = { ...node.data, types: undefined };
		const result = this.typeResolver.resolveNodeTypesUncached(
			node,
			this.getIncomingEdges(nodeId),
			data,
			this.lookup,
			this.viewBindings(node.id, path),
		);
		return result.inputTypes[inputId] ?? forced;
	}

	/**
	 * Resolve the type carried by one output handle of a node.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveOutputHandleType(nodeId: string, handleId: string, path?: readonly string[]): WgslType {
		const outputs = this.resolveNodeOutputs(nodeId, path);
		return (
			outputs.find((o) => o.id === handleId)?.type ?? this.resolveNodeOutputType(nodeId, path)
		);
	}

	/**
	 * Resolve the active inputs for a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveNodeInputs(nodeId: string, path?: readonly string[]): NodeInputDef[] {
		const node = this.resolveNode(nodeId);
		return node ? this.typesOf(node, path).resolvedInputs : [];
	}

	/**
	 * Resolve the active outputs for a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveNodeOutputs(nodeId: string, path?: readonly string[]): NodeOutputDef[] {
		const node = this.resolveNode(nodeId);
		return node ? this.typesOf(node, path).resolvedOutputs : [];
	}

	/**
	 * Invalidate types for the given node IDs and all their ancestors.
	 * Walks backward through the reverse graph, recomputing only affected nodes.
	 * Stops at group-output boundaries (within the same document).
	 * Cross-document propagation goes through `node-group` instances.
	 */
	invalidateTypes(nodeIds: string[]): void {
		const allEdges = [...this.project.definitions.values()].flatMap((d) => d.edges);
		const invalidated = this.typeResolver.invalidate(
			nodeIds,
			(id) => this.resolveNode(id),
			allEdges,
		);

		// Recompute types for all invalidated nodes, as seen from every path viewed.
		const caches = new Map<string, Map<string, ResolvedTypes>>();
		for (const path of this.viewedPaths()) {
			const cache = new Map(this.typesAt(path));
			for (const nodeId of invalidated) {
				const node = this.resolveNode(nodeId);
				if (!node) continue;
				const incoming = allEdges.filter((e) => e.target === nodeId);
				cache.set(
					nodeId,
					this.typeResolver.resolveNodeTypes(
						node,
						incoming,
						this.lookup,
						this.viewBindings(node.id, path),
					),
				);
			}
			caches.set(pathKey(path), cache);
		}
		this.state.typeCaches = caches;

		// Disconnect edges to outputs/inputs that no longer exist
		// (e.g. separate vec3f → vec2f drops z output; declare vec3f → f32 drops y/w inputs)
		const documents = this.project.definitions.values();
		for (const nodeId of invalidated) {
			const cached = this.typeCache.get(nodeId);
			if (!cached) continue;

			// Clean dangling source handles (outputs) — read from cached resolved outputs
			const activeOutIds = new Set(cached.resolvedOutputs.map((o) => o.id));
			for (const doc of documents) {
				doc.edges = doc.edges.filter(
					(e) => !(e.source === nodeId && !activeOutIds.has(e.sourceHandle)),
				);
				indexDocument(doc);
			}

			// Clean dangling target handles (inputs) — read from cached resolved inputs
			const activeInIds = new Set(cached.resolvedInputs.map((i) => i.id));
			for (const doc of documents) {
				doc.edges = doc.edges.filter(
					(e) => !(e.target === nodeId && !activeInIds.has(e.targetHandle)),
				);
				indexDocument(doc);
			}
		}

		this.state.typeCaches = new Map(this.state.typeCaches);
		this.refreshViewTypes();
	}

	private lookup = (id: string) => this.resolveNode(id);

	/**
	 * The variables' types of the groups on a breadcrumb path, by
	 * definitionRef: those of the group node each was entered through.
	 */
	protected pathBindings(path: readonly string[] = this.path): Map<string, TypeBindings> {
		const bound = new Map<string, TypeBindings>();
		let bindings: TypeBindings = {};
		let doc = this.root;
		for (const { node, group, definition } of this.walkPath(path)) {
			const incoming = doc.edgesByTarget.get(node.id) ?? [];
			bindings =
				this.typeResolver.resolveNodeTypes(node, incoming, this.lookup, bindings)
					.bindings ?? {};
			bound.set(group.definitionRef, bindings);
			doc = definition;
		}
		return bound;
	}

	/** The variables' types a node's document is viewed with from `path` (see `pathBindings`). */
	viewBindings(nodeId: string, path: readonly string[] = this.path): TypeBindings {
		const viewed = this.pathBindings(path);
		for (const [ref, bindings] of viewed) {
			if (this.project.definitions.get(ref)?.nodesById.has(nodeId)) return bindings;
		}
		return {};
	}

	/** The paths types are kept for: the root's, the graph areas' and the active one. */
	private viewedPaths(): string[][] {
		const paths = new Map<string, string[]>([["", []]]);
		for (const area of this.graphAreas())
			paths.set(pathKey(area.editor.path), area.editor.path);
		paths.set(pathKey(this.path), this.path);
		return [...paths.values()];
	}

	/**
	 * Types as seen from `path`: the root's for documents viewed without
	 * variables bound, computed for those its groups bind.
	 */
	private computeTypesAt(path: readonly string[], root: Map<string, ResolvedTypes>) {
		const cache = new Map(root);
		for (const [ref, bindings] of this.pathBindings(path)) {
			const doc = this.project.definitions.get(ref);
			if (!doc || bindingsKey(bindings) === bindingsKey({})) continue;
			const resolved = this.typeResolver.computeAll(
				doc.nodes,
				doc.edges,
				this.lookup,
				bindings,
			);
			for (const [nodeId, result] of resolved) cache.set(nodeId, result);
		}
		return cache;
	}

	/** The variables' types each path's cache was computed with, by `pathKey`. */
	private viewSignatures = new Map<string, string>();

	private bindingsSignature(path: readonly string[]): string {
		return [...this.pathBindings(path)].map(([ref, b]) => `${ref}:${bindingsKey(b)}`).join("|");
	}

	/**
	 * Keep types for the paths viewed now: computing those of new paths and
	 * of paths whose groups now bind other types, dropping the rest.
	 */
	private refreshViewTypes() {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a project being set lays the screen out before its resolver exists
		if (!this.typeResolver) return;
		const root = this.state.typeCaches.get("");
		if (!root) return;
		const caches = new Map<string, Map<string, ResolvedTypes>>([["", root]]);
		const signatures = new Map<string, string>();
		let changed = false;
		for (const path of this.viewedPaths()) {
			const key = pathKey(path);
			if (key === "") continue;
			const signature = this.bindingsSignature(path);
			signatures.set(key, signature);
			const existing = this.state.typeCaches.get(key);
			if (existing && this.viewSignatures.get(key) === signature) {
				caches.set(key, existing);
			} else {
				caches.set(key, this.computeTypesAt(path, root));
				changed = true;
			}
		}
		this.viewSignatures = signatures;
		if (changed || caches.size !== this.state.typeCaches.size) this.state.typeCaches = caches;
	}

	/**
	 * Rebuild every type cache from scratch. Called on project load
	 * and when the document structure changes fundamentally.
	 */
	rebuildTypeCache(): void {
		this.dropStaleCaseLinks();

		// Clear the TypeResolver's memoisation cache so every node is recomputed
		this.typeResolver.clearCache();

		const root = new Map<string, ResolvedTypes>();
		for (const doc of this.project.definitions.values()) {
			const resolved = this.typeResolver.computeAll(doc.nodes, doc.edges, this.lookup, {});
			for (const [nodeId, result] of resolved) root.set(nodeId, result);
		}
		this.state.typeCaches = new Map([["", root]]);
		this.viewSignatures = new Map();
		this.refreshViewTypes();
	}

	/**
	 * Remove links into Match cases their enum no longer has: a variant was
	 * removed, or another enum (or none) was linked to the node.
	 */
	private dropStaleCaseLinks() {
		for (const doc of this.project.definitions.values()) {
			const kept = doc.edges.filter((e) => {
				const node = doc.nodesById.get(e.target);
				if (node?.type !== MATCH || !isCaseHandle(e.targetHandle)) return true;
				return this.resolveDescriptor(node).inputs.some((i) => i.id === e.targetHandle);
			});
			if (kept.length !== doc.edges.length) this.setContent(doc, { edges: kept });
		}
	}

	// ── Node data edits ─────────────────────────────────────────────────────────

	/**
	 * Merge `patch` into a node's data, in its document (`undefined`
	 * clears a field). The node object is replaced, never mutated, so front
	 * ends notice. Types are re-resolved unless `retype` is false (plain value
	 * edits, e.g. while scrubbing).
	 */
	updateNodeData(nodeId: string, patch: Partial<NodeData>, { retype = true } = {}) {
		const node = this.resolveNode(nodeId);
		if (!node) return;
		const data: NodeData = { ...node.data, ...patch };
		this.patchNodeData(new Map([[nodeId, data]]));
		if (retype) this.invalidateTypes([nodeId]);
	}

	/** Set the value an input holds while unlinked (`undefined` clears it). */
	setInputValue(nodeId: string, inputId: string, value: InputValue | undefined) {
		const node = this.resolveNode(nodeId);
		if (!node) return;
		const values = withEntry(node.data.values, inputId, value);
		const widget = this.resolveDescriptor(node).widget;
		const converted =
			widget?.kind === "color" && widget.mode === inputId
				? this.keepColor(node, widget, values)
				: values;
		this.updateNodeData(nodeId, { values: converted }, { retype: false });
	}

	/**
	 * `values` with a colour widget's new mode's components set from its
	 * former mode's, so the colour stays the same (unlike Blender's Combine
	 * Color, which keeps the numbers). Only possible while none is linked: a
	 * linked one's value is only known in the shader.
	 */
	private keepColor(
		node: GraphNode,
		widget: NodeColorWidget,
		values: Record<string, InputValue> | undefined,
	): Record<string, InputValue> | undefined {
		const descriptor = this.resolveDescriptor(node);
		const defaults = descriptor.defaultData.values;
		const control = descriptor.inputs.find((i) => i.id === widget.mode)?.control;
		const variants = control?.kind === "enum" ? control.variants : [];
		const modeOf = (stored: Record<string, InputValue> | undefined) =>
			widget.modes[
				String(enumValue(stored?.[widget.mode] ?? defaults?.[widget.mode], variants))
			];
		const from = modeOf(node.data.values);
		const to = modeOf(values);
		const linked = new Set(this.getIncomingEdges(node.id).map((e) => e.targetHandle));
		if (!from || !to || from === to) return values;
		if ([...from.components, ...to.components].some((c) => linked.has(c))) return values;
		const read = (c: string) => readComponent(values?.[c] ?? defaults?.[c], "_");
		const [x, y, z] = from.components.map(read);
		const next = convertColorMode(from.space, to.space, [x ?? 0, y ?? 0, z ?? 0]);
		const converted = { ...values };
		to.components.forEach((c, i) => {
			converted[c] = next[i] ?? 0;
		});
		return converted;
	}

	/** Replace a node's curve (see `NodeData.curve`). */
	setCurve(nodeId: string, curve: CurvePoint[]) {
		this.updateNodeData(nodeId, { curve }, { retype: false });
	}

	/** Pick an option of one of the node's settings. */
	setSetting(nodeId: string, key: string, value: string) {
		const node = this.resolveNode(nodeId);
		if (!node) return;
		this.updateNodeData(nodeId, { settings: withEntry(node.data.settings, key, value) });
	}
}

/** `record` with `key` set to `value` (removed when undefined); undefined once empty. */
export function withEntry<T>(
	record: Readonly<Record<string, T>> | undefined,
	key: string,
	value: T | undefined,
): Record<string, T> | undefined {
	const entries = Object.entries({ ...record, [key]: value }).filter(
		(entry): entry is [string, T] => entry[1] !== undefined,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
