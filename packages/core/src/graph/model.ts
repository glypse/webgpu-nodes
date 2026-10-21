import * as v from "valibot";

import type { AddMenuEntry } from "../catalog/add-menu";
import { standardLibrary } from "../library";
import { defaultDataForType, nodeRegistry } from "../nodes/registry";
import {
	type HandleDef,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeOutputDef,
	type WgslType,
	familyKey,
	isConnectionCompatible,
	isWgslType,
	typeKind,
} from "../types";
import { TypeResolver } from "../types/resolver";
import {
	DEFAULT_ITERATIONS,
	DEFAULT_MAX_ITERATIONS,
	NEW_ITEM_HANDLE,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	type ZoneAnalysis,
	analyzeZones,
	pairedOutputId,
	wouldCreateCycle,
	zoneItems,
} from "../zones";
import {
	type GraphDocument,
	type GraphDocumentEdge,
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
import {
	BOUNDARY_TYPES,
	buildBoundaryNode,
	classifyEdges,
	cloneSubgraph,
	computeSelectionBounds,
	deduplicateBySource,
	groupRefsOf,
	handlesOf,
	rewireIncomingGroup,
	rewireOutgoingGroup,
	stableStringify,
} from "./editing";
import { History, type HistoryCounts } from "./history";
import {
	hydrateDocument,
	hydrateProject,
	indexDocument,
	normaliseDocument,
	resolveDescriptor,
	serialiseDocument,
	serialiseEdge,
	serialiseNode,
} from "./hydrate";
import { GraphProjectSchema, StandardLibraryEntriesSchema } from "./schema";

/** Resolved types of one node, as cached by the model. */
export type ResolvedTypes = {
	inputTypes: Record<string, WgslType>;
	outputType: WgslType;
	resolvedInputs: NodeInputDef[];
	resolvedOutputs: NodeOutputDef[];
};

/**
 * The model's mutable state. The model only ever reassigns these fields
 * (never mutates `path` or `selectedNodeIds` in place, and replaces
 * `typeCache` after each update), so a front end can make them reactive by
 * returning a reactive object from `GraphModel.createState`.
 */
export type GraphModelState = {
	project: HydratedGraphProject;
	path: string[];
	selectedNodeIds: string[];
	typeCache: Map<string, ResolvedTypes>;
};

export type TypeChoice = {
	types: readonly WgslType[];
	/** Whether links can decide the type (otherwise it's always picked). */
	inferable: boolean;
	/** The type the user picked, if any. */
	forced: WgslType | undefined;
	/** The type the node has without a pick. */
	inferred: WgslType;
};

function typeOverrides(node: GraphNode): Record<string, unknown> {
	return (node.data.__nodeTypeOverrides as Record<string, unknown> | undefined) ?? {};
}

export function emptyProject(): GraphProject {
	return { definitions: { [ROOT_ID]: { nodes: [], edges: [] } } };
}

/**
 * The whole editable project, headless: documents and groups, repeat zones,
 * type inference, connection rules and undo history. Every edit a front end
 * offers goes through here, and `generateShader` compiles it.
 *
 * Front ends subclass it to plug in their own reactivity, by overriding the
 * `create*` factories (state, documents, history counts).
 */
export class GraphModel {
	protected readonly state: GraphModelState = this.createState();

	/** Read-only standard library entries for browsing. */
	readonly library: readonly StandardLibraryEntry[] = standardLibrary;

	/** Centralised type resolver — single source of truth for all type resolution. */
	typeResolver!: TypeResolver;

	/** Content snapshots of past states (see `contentSnapshot`). */
	readonly history = new History(this.createHistoryCounts());

	constructor(project: GraphProject = emptyProject()) {
		this.setProject(project);
		this.markSaved();
		this.history.reset(this.contentSnapshot());
	}

	// ── Factories for front ends ────────────────────────────────────────────

	/** The model's mutable state; override to return a reactive object. */
	protected createState(): GraphModelState {
		return {
			project: { definitions: new Map() },
			path: [],
			selectedNodeIds: [],
			typeCache: new Map(),
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

	// ── State ───────────────────────────────────────────────────────────────

	/** The entire project tree. */
	get project(): HydratedGraphProject {
		return this.state.project;
	}
	set project(value: HydratedGraphProject) {
		this.state.project = value;
	}

	/**
	 * Breadcrumb path of group-node ids from root down to the currently-viewed subgraph.
	 * [] means "viewing root". ["node-7"] means "viewing node-7's content".
	 * ["node-7", "node-12"] means nested two levels deep.
	 */
	get path(): string[] {
		return this.state.path;
	}
	set path(value: string[]) {
		this.state.path = value;
	}

	/** Currently selected node IDs (grouping acts on them, ungrouping selects its result). */
	get selectedNodeIds(): string[] {
		return this.state.selectedNodeIds;
	}
	set selectedNodeIds(value: string[]) {
		this.state.selectedNodeIds = value;
	}

	/**
	 * Cache of resolved types per node, keyed by node ID. Replaced (never
	 * mutated) after graph mutations.
	 */
	get typeCache(): Map<string, ResolvedTypes> {
		return this.state.typeCache;
	}
	set typeCache(value: Map<string, ResolvedTypes>) {
		this.state.typeCache = value;
	}

	/** Shortcut for the root document. Always exists after construction. */
	get root(): HydratedGraphDocument {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ROOT_ID is always present
		return this.project.definitions.get(ROOT_ID)!;
	}

	/**
	 * Replace the whole project: hydrate it, register the standard library
	 * definitions next to it (so group nodes can reference them), and rebuild
	 * the type resolver and type cache for the new definitions.
	 */
	protected setProject(project: GraphProject) {
		const create = () => this.createDocument();
		this.project = hydrateProject(project, create);
		for (const entry of this.library) {
			const def = normaliseDocument(entry.definition);
			def.label = entry.label;
			this.project.definitions.set(entry.id, hydrateDocument(def, create));
		}
		this.typeResolver = new TypeResolver(
			(n) => this.resolveDescriptor(n),
			this.project.definitions,
			(id) => this.getIncomingEdges(id),
		);
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
		const inPath = this.path.some((nodeId) => {
			const ref = this.root.nodesById.get(nodeId)?.group?.definitionRef;
			return ref !== undefined && removed.has(ref);
		});
		if (inPath) this.path = [];
	}

	protected setContent(
		doc: HydratedGraphDocument,
		content: { nodes?: GraphNode[]; edges?: GraphEdge[] },
	) {
		if (content.nodes) doc.nodes = content.nodes;
		if (content.edges) doc.edges = content.edges;
		indexDocument(doc);
	}

	// ── Undo / redo ─────────────────────────────────────────────────────────

	/**
	 * Record the current content as a history step. Cheap to call often: an
	 * unchanged project records nothing.
	 */
	recordHistory() {
		this.history.record(this.contentSnapshot());
	}

	undo() {
		// A change not recorded yet (still debounced) is the step to undo.
		this.recordHistory();
		const snapshot = this.history.undo();
		if (snapshot !== undefined) this.restoreSnapshot(snapshot);
	}

	redo() {
		this.recordHistory();
		const snapshot = this.history.redo();
		if (snapshot !== undefined) this.restoreSnapshot(snapshot);
	}

	/**
	 * Restore a content snapshot, keeping each document's camera and as much
	 * of the breadcrumb path as still exists.
	 */
	private restoreSnapshot(snapshot: string) {
		const parsed = v.safeParse(GraphProjectSchema, JSON.parse(snapshot));
		if (!parsed.success) {
			console.error("[graph] corrupted history snapshot", v.flatten(parsed.issues));
			return;
		}
		const viewports = new Map(
			[...this.project.definitions.entries()].map(([key, doc]) => [key, doc.viewport]),
		);
		const path = this.path;
		this.setProject(parsed.output);
		for (const [key, doc] of this.project.definitions) {
			doc.viewport ??= viewports.get(key);
		}

		const validPath: string[] = [];
		let current = this.root;
		for (const nodeId of path) {
			const node = current.nodesById.get(nodeId);
			const definition =
				node?.group && this.project.definitions.get(node.group.definitionRef);
			if (!definition) break;
			validPath.push(nodeId);
			current = definition;
		}
		this.path = validPath;
		this.selectedNodeIds = [];
		// Hydration may normalise the content (e.g. fill in default data):
		// that normalised form is the state we're now at.
		this.history.replaceCurrent(this.contentSnapshot());
	}

	// ── Unsaved changes ─────────────────────────────────────────────────────

	/** Content snapshot of the project as last loaded or saved. */
	private savedSnapshot = "";

	/**
	 * Serialised content of the user's documents (standard library and
	 * per-document cameras excluded): two projects with equal snapshots
	 * render and edit the same.
	 */
	contentSnapshot(): string {
		const definitions = Object.fromEntries(
			[...this.project.definitions.entries()]
				.filter(([key]) => !this.isStandardLibrary(key))
				.map(([key, doc]) => [key, serialiseDocument(doc)]),
		);
		return stableStringify({ definitions });
	}

	markSaved() {
		this.savedSnapshot = this.contentSnapshot();
	}

	hasUnsavedChanges(): boolean {
		return this.contentSnapshot() !== this.savedSnapshot;
	}

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

	/**
	 * Find all edges targeting a node across the entire project.
	 * Used by TypeResolver for recursive type inference.
	 */
	private getIncomingEdges(nodeId: string): GraphEdge[] {
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
	private *walkPath(): Generator<{
		node: GraphNode;
		group: NonNullable<GraphNode["group"]>;
		definition: HydratedGraphDocument;
		nodeId: string;
	}> {
		let current: HydratedGraphDocument = this.root;
		for (const nodeId of this.path) {
			const node = current.nodesById.get(nodeId);
			if (!node?.group) return;
			const definition = this.project.definitions.get(node.group.definitionRef);
			if (!definition) return;
			yield { node, group: node.group, definition, nodeId };
			current = definition;
		}
	}

	get activeDocument(): HydratedGraphDocument {
		let current: HydratedGraphDocument = this.root;
		let steps = 0;
		for (const { definition } of this.walkPath()) {
			current = definition;
			steps++;
		}
		// If the walk didn't consume the entire path, the path is invalid — reset
		if (steps !== this.path.length) {
			this.path = [];
			return this.root;
		}
		return current;
	}

	resolveDescriptor(node: GraphNode): NodeDescriptor {
		return resolveDescriptor(node, this.project.definitions);
	}

	// ── Zones ───────────────────────────────────────────────────────────────

	private zoneCache = new WeakMap<
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

	/** Whether an edge of the active document breaks zone rules (drawn red, ignored by codegen). */
	isEdgeInvalid(edgeId: string): boolean {
		return this.activeZones.invalidEdges.has(edgeId);
	}

	/**
	 * Whether a link may be made (e.g. a UI's connection validator). Rejects:
	 * - connections that would close a cycle (zones included),
	 * - type mismatches (a higher-N value into a lower-N input),
	 * - connections breaking zone rules, or invalidating existing links.
	 * Dropping on a zone's virtual "new item" handle accepts any type.
	 */
	isValidConnection(connection: {
		source?: string | null;
		sourceHandle?: string | null;
		target?: string | null;
		targetHandle?: string | null;
	}): boolean {
		if (!connection.source || !connection.target) return false;
		const doc = this.activeDocument;
		const sourceNode = doc.nodesById.get(connection.source);
		const targetNode = doc.nodesById.get(connection.target);
		if (!sourceNode || !targetNode) return false;

		const sourceHandle = connection.sourceHandle ?? "";
		const targetHandle = connection.targetHandle ?? "";
		if (sourceHandle === NEW_ITEM_HANDLE && targetHandle === NEW_ITEM_HANDLE) return false;
		if (wouldCreateCycle(doc.nodes, doc.edges, connection.source, connection.target)) {
			return false;
		}

		if (sourceHandle !== NEW_ITEM_HANDLE && targetHandle !== NEW_ITEM_HANDLE) {
			if (!this.isTypeCompatible(sourceNode, sourceHandle, targetNode, targetHandle)) {
				return false;
			}
		}

		return this.respectsZones(doc, targetNode, {
			id: "__candidate__",
			source: connection.source,
			sourceHandle,
			target: connection.target,
			targetHandle,
		});
	}

	/**
	 * Simulate adding `candidate` (replacing whatever already feeds a
	 * non-variadic target) and check that neither it nor any existing link
	 * ends up breaking zone rules.
	 */
	private respectsZones(
		doc: HydratedGraphDocument,
		targetNode: GraphNode,
		candidate: GraphEdge,
	): boolean {
		const variadic = this.resolveDescriptor(targetNode).inputs.find(
			(i) => i.id === candidate.targetHandle,
		)?.variadic;
		const kept = doc.edges.filter(
			(e) =>
				variadic === true ||
				candidate.targetHandle === NEW_ITEM_HANDLE ||
				!(e.target === candidate.target && e.targetHandle === candidate.targetHandle),
		);
		const before = this.zoneAnalysis(doc).invalidEdges;
		const after = analyzeZones(doc.nodes, [...kept, candidate]).invalidEdges;
		for (const id of after) if (!before.has(id)) return false;
		return true;
	}

	private isTypeCompatible(
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
		const nodeOverrides = targetNode.data.__nodeTypeOverrides as
			| Record<string, WgslType>
			| undefined;
		const overrideType = nodeOverrides?.[targetInputDef.types.join(",")];
		if (overrideType) return isConnectionCompatible(sourceType, overrideType);

		// Valid if the source can be converted to any type within the family
		return targetInputDef.types.some((t) => isConnectionCompatible(sourceType, t));
	}

	/**
	 * Add a new repeat zone (paired input/output nodes) to the active document,
	 * with one f32 state item passed straight through.
	 * Returns the Repeat Input's id, or undefined if the document is locked.
	 */
	createRepeatZone(position: { x: number; y: number }): string | undefined {
		if (this.isLocked) return undefined;
		const inputId = crypto.randomUUID();
		const outputId = crypto.randomUUID();
		const item: HandleDef = { id: crypto.randomUUID(), label: "Value", type: "f32" };

		const nodes: GraphNode[] = [
			{
				id: inputId,
				type: REPEAT_INPUT,
				data: {
					pairedOutput: outputId,
					iterations: DEFAULT_ITERATIONS,
					maxIterations: DEFAULT_MAX_ITERATIONS,
					[item.id]: 0,
				},
				position,
			},
			{
				id: outputId,
				type: REPEAT_OUTPUT,
				data: { items: [item] },
				position: { x: position.x + ZONE_SPACING, y: position.y },
			},
		];
		const passthrough: GraphEdge = {
			id: crypto.randomUUID(),
			source: inputId,
			sourceHandle: item.id,
			target: outputId,
			targetHandle: item.id,
		};

		const doc = this.activeDocument;
		doc.nodes = [...doc.nodes, ...nodes];
		doc.edges = [...doc.edges, passthrough];
		indexDocument(doc);
		this.rebuildTypeCache();
		return inputId;
	}

	/** The paired Repeat Input / Repeat Output nodes of a zone in the active document. */
	private zoneNodes(zoneId: string): { input: GraphNode; output: GraphNode } | undefined {
		const doc = this.activeDocument;
		const input = doc.nodesById.get(zoneId);
		const output = input ? doc.nodesById.get(pairedOutputId(input) ?? "") : undefined;
		if (input?.type !== REPEAT_INPUT || output?.type !== REPEAT_OUTPUT) return undefined;
		return { input, output };
	}

	getZoneItems(zoneId: string): HandleDef[] {
		return zoneItems(this.zoneNodes(zoneId)?.output);
	}

	/** Replace the data of some nodes of the active document (reactively). */
	private patchNodeData(patches: Map<string, Record<string, unknown>>) {
		const doc = this.activeDocument;
		doc.nodes = doc.nodes.map((n) => {
			const data = patches.get(n.id);
			return data ? { ...n, data } : n;
		});
		indexDocument(doc);
	}

	/** Write a zone's item list (on its output node) and refresh everything derived from it. */
	private setZoneItems(zoneId: string, items: HandleDef[]) {
		const zone = this.zoneNodes(zoneId);
		if (!zone || this.isLocked) return;
		const patches = new Map<string, Record<string, unknown>>([
			[zone.output.id, { ...zone.output.data, items }],
		]);
		this.patchNodeData(patches);

		// Drop links to items that no longer exist or no longer fit their type.
		const ids = new Set(items.map((i) => i.id));
		const doc = this.activeDocument;
		const boundary = new Set([zone.input.id, zone.output.id]);
		const fixed = new Set(["iterations", "iteration"]);
		doc.edges = doc.edges.filter((e) => {
			if (boundary.has(e.target) && !fixed.has(e.targetHandle) && !ids.has(e.targetHandle)) {
				return false;
			}
			if (boundary.has(e.source) && !fixed.has(e.sourceHandle) && !ids.has(e.sourceHandle)) {
				return false;
			}
			return true;
		});
		indexDocument(doc);
		this.rebuildTypeCache();
		doc.edges = doc.edges.filter((e) => {
			if (!boundary.has(e.source) && !boundary.has(e.target)) return true;
			const source = doc.nodesById.get(e.source);
			const target = doc.nodesById.get(e.target);
			return (
				!!source &&
				!!target &&
				this.isTypeCompatible(source, e.sourceHandle, target, e.targetHandle)
			);
		});
		indexDocument(doc);
		this.rebuildTypeCache();
	}

	/** Append a state item to a zone. Returns the new item. */
	addZoneItem(zoneId: string, type: WgslType, label?: string): HandleDef | undefined {
		const zone = this.zoneNodes(zoneId);
		if (!zone || this.isLocked) return undefined;
		const items = zoneItems(zone.output);
		const existing = new Set(items.map((i) => i.label));
		let name = label ?? "Value";
		for (let n = 2; existing.has(name); n++) name = `${label ?? "Value"} ${String(n)}`;
		const item: HandleDef = { id: crypto.randomUUID(), label: name, type };
		this.setZoneItems(zoneId, [...items, item]);
		return item;
	}

	removeZoneItem(zoneId: string, itemId: string) {
		const items = this.getZoneItems(zoneId).filter((i) => i.id !== itemId);
		this.setZoneItems(zoneId, items);
	}

	/** Rename a state item. Rejects empty or duplicate labels; returns whether it was applied. */
	renameZoneItem(zoneId: string, itemId: string, label: string): boolean {
		const trimmed = label.trim();
		const items = this.getZoneItems(zoneId);
		if (!trimmed || items.some((i) => i.id !== itemId && i.label === trimmed)) return false;
		this.setZoneItems(
			zoneId,
			items.map((i) => (i.id === itemId ? { ...i, label: trimmed } : i)),
		);
		return true;
	}

	/** Change a state item's type; links that no longer fit are removed. */
	setZoneItemType(zoneId: string, itemId: string, type: WgslType) {
		const items = this.getZoneItems(zoneId);
		this.setZoneItems(
			zoneId,
			items.map((i) => (i.id === itemId ? { ...i, type } : i)),
		);
	}

	/** Move a state item up (-1) or down (+1) in the list. */
	moveZoneItem(zoneId: string, itemId: string, offset: -1 | 1) {
		const items = [...this.getZoneItems(zoneId)];
		const index = items.findIndex((i) => i.id === itemId);
		const target = index + offset;
		const item = items[index];
		const other = items[target];
		if (!item || !other) return;
		items[index] = other;
		items[target] = item;
		this.setZoneItems(zoneId, items);
	}

	/** Set a zone's iteration safety cap. */
	setZoneMaxIterations(zoneId: string, max: number) {
		const zone = this.zoneNodes(zoneId);
		if (!zone || this.isLocked) return;
		const value = Math.max(0, Math.trunc(Number.isFinite(max) ? max : DEFAULT_MAX_ITERATIONS));
		this.patchNodeData(
			new Map([[zone.input.id, { ...zone.input.data, maxIterations: value }]]),
		);
	}

	/**
	 * Complete a connection dropped on a zone's virtual "new item" handle:
	 * create an item typed after the other end, then link to it.
	 * Returns false when the connection doesn't involve the virtual handle.
	 */
	connectNewZoneItem(connection: {
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle: string;
	}): boolean {
		const toNew = connection.targetHandle === NEW_ITEM_HANDLE;
		const fromNew = connection.sourceHandle === NEW_ITEM_HANDLE;
		if (!toNew && !fromNew) return false;

		const zoneNodeId = toNew ? connection.target : connection.source;
		const zoneId = this.activeZones.zoneOfBoundary.get(zoneNodeId);
		if (!zoneId) return true;

		let type: WgslType;
		let label: string | undefined;
		if (toNew) {
			type = this.resolveOutputHandleType(connection.source, connection.sourceHandle);
			label = this.resolveNodeOutputs(connection.source).find(
				(o) => o.id === connection.sourceHandle,
			)?.label;
		} else {
			type = this.resolveInputType(connection.target, connection.targetHandle);
			label = this.resolveNodeInputs(connection.target).find(
				(i) => i.id === connection.targetHandle,
			)?.label;
		}
		const item = this.addZoneItem(zoneId, type, label);
		if (!item) return true;

		const edge: GraphEdge = {
			id: crypto.randomUUID(),
			source: connection.source,
			sourceHandle: fromNew ? item.id : connection.sourceHandle,
			target: connection.target,
			targetHandle: toNew ? item.id : connection.targetHandle,
		};
		const doc = this.activeDocument;
		const replaced = (e: GraphEdge) =>
			!toNew && e.target === edge.target && e.targetHandle === edge.targetHandle;
		doc.edges = [...doc.edges.filter((e) => !replaced(e)), edge];
		indexDocument(doc);
		this.rebuildTypeCache();
		return true;
	}

	/**
	 * Link two handles of the active document. Non-variadic inputs keep a
	 * single incoming link (the new one replaces it); a zone's virtual handle
	 * creates a state item.
	 */
	connect(connection: {
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle: string;
	}) {
		if (this.connectNewZoneItem(connection)) return;
		const doc = this.activeDocument;
		const targetNode = doc.nodesById.get(connection.target);
		const variadic = targetNode
			? this.resolveDescriptor(targetNode).inputs.find(
					(i) => i.id === connection.targetHandle,
				)?.variadic === true
			: false;
		const replaced = (e: GraphEdge) =>
			e.target === connection.target &&
			e.targetHandle === connection.targetHandle &&
			(!variadic ||
				(e.source === connection.source && e.sourceHandle === connection.sourceHandle));
		const edge: GraphEdge = { id: crypto.randomUUID(), ...connection };
		doc.edges = [...doc.edges.filter((e) => !replaced(e)), edge];
		indexDocument(doc);
		this.rebuildTypeCache();
	}

	/**
	 * The handle of a freshly created `entry` that a link being dragged from
	 * `pending` would connect to, or undefined if nothing fits. Handles whose
	 * scalar kind matches the dragged value are preferred.
	 */
	entryHandleFor(entry: AddMenuEntry, pending: PendingConnection): string | undefined {
		if (entry.kind === "zone") return NEW_ITEM_HANDLE;
		if (entry.kind === "node" && entry.type === "node-group") return undefined;

		const fresh = this.freshNodeTypes(entry);
		if (!fresh) return undefined;
		const rank = (candidates: readonly WgslType[], value: WgslType, valueIsSource: boolean) => {
			const fits = candidates.filter((t) =>
				valueIsSource ? isConnectionCompatible(value, t) : isConnectionCompatible(t, value),
			);
			if (fits.length === 0) return 2;
			return fits.some((t) => typeKind(t) === typeKind(value)) ? 0 : 1;
		};
		const best = <T extends { id: string }>(items: T[], score: (item: T) => number) => {
			let found: T | undefined;
			let bestScore = 2;
			for (const item of items) {
				const value = score(item);
				if (value < bestScore) {
					found = item;
					bestScore = value;
				}
			}
			return found?.id;
		};

		if (pending.handleType === "source") {
			const value = this.resolveOutputHandleType(pending.nodeId, pending.handleId);
			return best(fresh.resolvedInputs, (input) => rank(input.types, value, true));
		}
		const value = this.resolveInputType(pending.nodeId, pending.handleId);
		return best(fresh.resolvedOutputs, (output) => rank([output.type], value, false));
	}

	/** Types a node created from `entry` would have before anything is linked to it. */
	private freshNodeTypes(entry: AddMenuEntry) {
		const FRESH_ID = "__fresh_node__";
		const node: GraphNode =
			entry.kind === "group" && entry.definitionRef
				? {
						id: FRESH_ID,
						type: "node-group",
						data: {},
						position: { x: 0, y: 0 },
						group: { definitionRef: entry.definitionRef, locked: true },
					}
				: {
						id: FRESH_ID,
						type: entry.type ?? "",
						data: defaultDataForType(entry.type ?? ""),
						position: { x: 0, y: 0 },
					};
		if (node.type !== "node-group" && !nodeRegistry[node.type ?? ""]) return undefined;
		const resolved = this.typeResolver.resolveNodeTypes(node, [], (id) =>
			id === FRESH_ID ? node : this.resolveNode(id),
		);
		this.typeResolver.cache.delete(FRESH_ID);
		return resolved;
	}

	/**
	 * Create `entry` at `position` (flow coordinates) and link it to the
	 * handle the dragged link started from (see `entryHandleFor`).
	 * Returns the created node's id, if any.
	 */
	addMenuEntryConnected(
		entry: AddMenuEntry,
		position: { x: number; y: number },
		pending: PendingConnection,
	): string | undefined {
		const handle = this.entryHandleFor(entry, pending);
		const upstream = pending.handleType === "target";
		// Feeding an input: put the new node's outputs (its right side) at the drop point.
		const offset = !upstream
			? 0
			: entry.kind === "zone"
				? ZONE_SPACING + NODE_WIDTH
				: NODE_WIDTH;
		const created = this.addMenuEntry(entry, { x: position.x - offset, y: position.y });
		if (!created || !handle) return created;

		let nodeId = created;
		if (entry.kind === "zone" && upstream) {
			const input = this.activeDocument.nodesById.get(created);
			nodeId = (input && pairedOutputId(input)) ?? created;
		}
		const connection = upstream
			? {
					source: nodeId,
					sourceHandle: handle,
					target: pending.nodeId,
					targetHandle: pending.handleId,
				}
			: {
					source: pending.nodeId,
					sourceHandle: pending.handleId,
					target: nodeId,
					targetHandle: handle,
				};
		if (this.isValidConnection(connection)) this.connect(connection);
		return created;
	}

	/**
	 * Zone nodes always go in pairs: extend a deletion to the partner of every
	 * deleted zone node, and to the edges connected to those partners.
	 */
	expandDeletion<
		N extends { id: string },
		E extends { id: string; source: string; target: string },
	>(nodes: N[], edges: E[]): { nodes: N[]; edges: E[] } {
		const doc = this.activeDocument;
		const zones = this.activeZones;
		const nodeIds = new Set(nodes.map((n) => n.id));
		const extraNodes: N[] = [];
		for (const node of nodes) {
			const zone = zones.zones.get(zones.zoneOfBoundary.get(node.id) ?? "");
			if (!zone) continue;
			for (const partnerId of [zone.inputId, zone.outputId]) {
				if (nodeIds.has(partnerId)) continue;
				const partner = doc.nodesById.get(partnerId);
				if (!partner) continue;
				nodeIds.add(partnerId);
				extraNodes.push(partner as unknown as N);
			}
		}
		const edgeIds = new Set(edges.map((e) => e.id));
		const extraEdges = (doc.edges as unknown as E[]).filter(
			(e) => !edgeIds.has(e.id) && (nodeIds.has(e.source) || nodeIds.has(e.target)),
		);
		return { nodes: [...nodes, ...extraNodes], edges: [...edges, ...extraEdges] };
	}

	get nodes(): GraphNode[] {
		return this.activeDocument.nodes;
	}
	set nodes(value: GraphNode[]) {
		this.activeDocument.nodes = value;
		indexDocument(this.activeDocument);
	}
	get edges(): GraphEdge[] {
		return this.activeDocument.edges;
	}
	set edges(value: GraphEdge[]) {
		this.activeDocument.edges = value;
		indexDocument(this.activeDocument);
		this.rebuildTypeCache();
	}

	/** Whether the currently-viewed subgraph (or any of its ancestors) is locked. */
	get isLocked(): boolean {
		for (const { group } of this.walkPath()) {
			if (group.locked) return true;
		}
		return false;
	}

	/** The definitionRef of the first selected group node, if any. */
	get selectedGroupRef(): string | undefined {
		for (const id of this.selectedNodeIds) {
			const node = this.activeDocument.nodesById.get(id);
			if (node?.type === "node-group" && node.group) {
				return node.group.definitionRef;
			}
		}
		return undefined;
	}

	/** Labels for each segment of the breadcrumb path, suitable for rendering. */
	get pathLabels(): { id: string; label: string; locked: boolean }[] {
		const labels: { id: string; label: string; locked: boolean }[] = [];
		for (const { node, definition, nodeId } of this.walkPath()) {
			if (node.type === "node-group") {
				labels.push({
					id: nodeId,
					label: definition.label ?? "Group",
					locked: node.group?.locked ?? false,
				});
			} else {
				const desc = nodeRegistry[node.type ?? ""];
				labels.push({
					id: nodeId,
					label: desc?.label ?? node.type ?? "unknown",
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

	loadProject(project: unknown): boolean {
		const parsed = v.safeParse(GraphProjectSchema, project);
		if (!parsed.success) {
			console.error("[graph] rejected invalid project JSON", v.flatten(parsed.issues));
			return false;
		}
		this.setProject(parsed.output);
		this.path = [];
		this.markSaved();
		this.history.reset(this.contentSnapshot());

		return true;
	}

	/** The project as saved: the user's documents, the standard library being the app's own. */
	getProjectJson(): string {
		const definitions = Object.fromEntries(
			[...this.project.definitions.entries()]
				.filter(([key]) => !this.isStandardLibrary(key))
				.map(([key, definition]) => [
					key,
					serialiseDocument(definition, { viewport: true }),
				]),
		);
		const project = { definitions };
		return JSON.stringify(project, null, "\t");
	}

	loadFromString(text: string): boolean {
		try {
			const project = JSON.parse(text) as unknown;
			return this.loadProject(project);
		} catch (err) {
			console.error("[graph] failed to parse JSON", err);
			return false;
		}
	}

	// ── Export / Import ───────────────────────────────────────────────────────

	/** Check if a definitionRef belongs to the standard library. */
	private isStandardLibrary(definitionRef: string): boolean {
		return this.library.some((e) => e.id === definitionRef);
	}

	/**
	 * Collect all definitionRefs that are "in scope" - i.e. the definitions
	 * the user is currently inside of, as determined by the breadcrumb path.
	 */
	private collectInScopeRefs(): Set<string> {
		const refs = new Set<string>();
		for (const { group } of this.walkPath()) {
			refs.add(group.definitionRef);
		}
		return refs;
	}

	/**
	 * User group definitions reachable through group nodes from `seeds`
	 * (seeds included). Standard-library definitions are never included nor
	 * walked: they can't reference user groups.
	 */
	private reachableUserRefs(seeds: Iterable<string>): Set<string> {
		const found = new Set<string>();
		const queue = [...seeds];
		for (let ref = queue.pop(); ref !== undefined; ref = queue.pop()) {
			if (found.has(ref) || this.isStandardLibrary(ref)) continue;
			found.add(ref);
			const def = this.project.definitions.get(ref);
			if (def) queue.push(...groupRefsOf(def));
		}
		return found;
	}

	/**
	 * Check whether adding an instance of `definitionRef` at the current path
	 * would create a circular reference (directly or transitively).
	 */
	wouldCreateCycle(definitionRef: string): boolean {
		const inScope = this.collectInScopeRefs();
		if (inScope.size === 0) return false;
		const refs = this.reachableUserRefs([definitionRef]);
		for (const ref of refs) {
			if (inScope.has(ref)) return true;
		}
		return false;
	}

	/** Collect every label currently in use (standard library + all definitions). */
	private usedLabels(): Set<string> {
		const labels = new Set<string>();
		for (const entry of this.library) {
			if (entry.label) labels.add(entry.label);
		}
		for (const def of this.project.definitions.values()) {
			if (def.label) labels.add(def.label);
		}
		return labels;
	}

	/** Generate a unique "X - Copy" / "X - Copy 2" / … label for a cloned definition. */
	private uniqueCopyLabel(sourceLabel: string | undefined): string {
		if (!sourceLabel) return "Group";
		const existing = this.usedLabels();
		const base = `${sourceLabel} - Copy`;
		if (!existing.has(base)) return base;
		let n = 2;
		while (existing.has(`${base} ${String(n)}`)) n++;
		return `${base} ${String(n)}`;
	}

	/** User group definitions nested (at any depth) inside a definition. */
	private collectNestedRefs(definitionRef: string): string[] {
		const def = this.project.definitions.get(definitionRef);
		const nested = this.reachableUserRefs(def ? groupRefsOf(def) : []);
		nested.delete(definitionRef);
		return [...nested];
	}

	/**
	 * Build the metadata for a single group definition export.
	 * The definitionRef is used as the stable id.
	 */
	private buildExportEntry(definitionRef: string):
		| {
				id: string;
				label: string;
				category: string;
				dependencies: string[];
				locked: boolean | undefined;
				definition: GraphDocument;
		  }
		| undefined {
		const def = this.project.definitions.get(definitionRef);
		if (!def) return undefined;

		const deps = this.collectNestedRefs(definitionRef);
		const entry = this.library.find((e) => e.id === definitionRef);

		return {
			id: definitionRef,
			label: def.label ?? entry?.label ?? "Group",
			category: entry?.category ?? "group",
			dependencies: deps,
			locked: def.locked,
			definition: structuredClone({
				nodes: def.nodes.map(serialiseNode),
				edges: def.edges.map(serialiseEdge),
			}),
		};
	}

	/**
	 * A group (and every user group it nests) as standalone JSON files, one
	 * per definition, ready to save and import elsewhere. Standard-library
	 * dependencies are left out.
	 */
	exportGroupFiles(definitionRef: string): { filename: string; contents: string }[] {
		const refs = new Set([definitionRef, ...this.collectNestedRefs(definitionRef)]);
		return [...refs].flatMap((ref) => {
			const entry = this.buildExportEntry(ref);
			if (!entry) return [];
			const slug = entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			return [{ filename: `${slug}.json`, contents: JSON.stringify(entry, null, "\t") }];
		});
	}

	/**
	 * Import group definitions from parsed JSON files.
	 * All files are loaded first, then dependencies are checked.
	 * Missing dependencies trigger a console warning but don't block the import.
	 */
	importGroups(
		jsonFiles: {
			id?: string;
			label?: string;
			category?: string;
			dependencies?: string[];
			definition?: GraphDocument;
		}[],
	): { imported: number; missing: string[]; rejected: string[] } {
		const parsed = v.safeParse(StandardLibraryEntriesSchema, jsonFiles);
		if (!parsed.success) {
			console.error("[graph] rejected invalid group import", v.flatten(parsed.issues));
			return {
				imported: 0,
				missing: [],
				rejected: jsonFiles.map((f) => f.id ?? "<unknown>"),
			};
		}

		const entries = parsed.output;
		// Phase 1: Load all definitions
		for (const file of entries) {
			const normalised = normaliseDocument(file.definition);
			if (file.label) normalised.label = file.label;
			normalised.locked = true;
			this.setDefinitions([[file.id, this.hydrate(normalised)]]);
		}

		// Phase 2: Check dependencies
		const missing: string[] = [];
		for (const file of entries) {
			for (const dep of file.dependencies) {
				if (!this.project.definitions.has(dep) && !this.isStandardLibrary(dep)) {
					missing.push(`${file.id} depends on ${dep}`);
				}
			}
		}

		if (missing.length > 0) {
			console.warn("[graph] imported groups have missing dependencies:", missing);
		}

		// New definitions may change how group nodes resolve their types
		this.rebuildTypeCache();

		return { imported: entries.length, missing, rejected: [] };
	}

	groupSelection(selectedNodeIds: Set<string>): void {
		const UNGROUPABLE_TYPES = new Set(["frag-output", "group-input", "group-output"]);

		// A zone is grouped as a whole: selecting either boundary brings in its
		// partner and everything inside it.
		const expandedIds = new Set(selectedNodeIds);
		const zones = this.activeZones;
		for (const id of selectedNodeIds) {
			const zone = zones.zones.get(zones.zoneOfBoundary.get(id) ?? "");
			if (!zone) continue;
			for (const member of [zone.inputId, zone.outputId, ...zone.members]) {
				expandedIds.add(member);
			}
		}

		const selectedNodes = this.activeDocument.nodes.filter(
			(node) => expandedIds.has(node.id) && !UNGROUPABLE_TYPES.has(node.type ?? ""),
		);

		if (selectedNodes.length === 0 || selectedNodes.every((n) => n.type === "node-group")) {
			return;
		}

		const filteredIds = new Set(selectedNodes.map((n) => n.id));
		if (this.groupingWouldCreateCycle(filteredIds)) {
			console.warn(
				"[graph] cannot group: the selection depends on itself through unselected nodes",
			);
			return;
		}
		const bounds = computeSelectionBounds(selectedNodes);

		const { internal, incoming, outgoing } = classifyEdges(
			filteredIds,
			this.activeDocument.edges, // We could pick only the GraphDocumentEdge properites of each Edge, but passing the raw object is more memory-efficient
		);
		const dedupedIncoming = deduplicateBySource(incoming);
		const dedupedOutgoing = deduplicateBySource(outgoing);

		const OFFSET = 300;

		const groupInputNode = buildBoundaryNode(
			"input",
			dedupedIncoming,
			this.typeResolver,
			(id) => this.resolveNode(id),
			{ x: bounds.minX - OFFSET, y: bounds.centerY },
		);
		const groupOutputNode = buildBoundaryNode(
			"output",
			dedupedOutgoing,
			this.typeResolver,
			(id) => this.resolveNode(id),
			{ x: bounds.maxX + OFFSET, y: bounds.centerY },
		);

		const definitionRef = crypto.randomUUID();
		const groupNodeId = crypto.randomUUID();

		const allOuterEdges: GraphDocumentEdge[] = [];
		const allInnerEdges: GraphDocumentEdge[] = [];

		dedupedIncoming.forEach((group) => {
			const handle = groupInputNode.handleFor.get(group);
			if (!handle) return; // Shouldn't happen

			const { outer, inner } = rewireIncomingGroup(
				group,
				handle,
				groupInputNode.node.id,
				groupNodeId,
			);
			allOuterEdges.push(outer);
			allInnerEdges.push(...inner);
		});

		dedupedOutgoing.forEach((group) => {
			const handle = groupOutputNode.handleFor.get(group);
			if (!handle) return; // Shouldn't happen

			const { outer, inner } = rewireOutgoingGroup(
				group,
				handle,
				groupOutputNode.node.id,
				groupNodeId,
			);
			allOuterEdges.push(...outer);
			allInnerEdges.push(inner);
		});

		const definition: GraphDocument = {
			nodes: [
				...(selectedNodes as GraphDocumentNode[]),
				groupInputNode.node,
				groupOutputNode.node,
			],
			edges: [...internal, ...allInnerEdges],
			label: this.nextGroupLabel(),
		};

		this.setDefinitions([[definitionRef, this.hydrate(definition)]]);

		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position: { x: bounds.centerX, y: bounds.centerY },
			group: { definitionRef, locked: false },
		};

		const touchedEdgeIds = new Set([
			...internal.map((e) => e.id),
			...incoming.map((e) => e.id),
			...outgoing.map((e) => e.id),
		]);

		this.activeDocument.nodes = [
			...this.activeDocument.nodes.filter((n) => !filteredIds.has(n.id)),
			groupNode,
		];
		indexDocument(this.activeDocument);

		this.activeDocument.edges = [
			...this.activeDocument.edges.filter((e) => !touchedEdgeIds.has(e.id)),
			...allOuterEdges,
		];
		indexDocument(this.activeDocument);

		// Clear the UI's selection state so moved nodes/edges
		// don't appear selected inside the newly created group.
		this.selectedNodeIds = [];
		for (const n of this.activeDocument.nodes) {
			n.selected = false;
		}
		for (const e of this.activeDocument.edges) {
			e.selected = false;
		}

		// Rebuild types since the graph structure changed significantly
		this.rebuildTypeCache();
	}

	/**
	 * Grouping collapses the selection into one node. If a path leaves the
	 * selection and comes back into it (zone dependencies included), that node
	 * would depend on itself.
	 */
	private groupingWouldCreateCycle(selection: Set<string>): boolean {
		const doc = this.activeDocument;
		const outside = doc.nodes.filter((n) => !selection.has(n.id));
		const GROUP = "__grouped_selection__";
		const collapse = (id: string) => (selection.has(id) ? GROUP : id);
		const edges = doc.edges
			.map((e) => ({ source: collapse(e.source), target: collapse(e.target) }))
			.filter((e) => e.source !== e.target);
		const nodes = [...outside, { id: GROUP, type: "node-group", data: {} }];
		// A cycle exists iff the collapsed node reaches itself via outside nodes.
		return edges.some(
			(e) => e.source === GROUP && wouldCreateCycle(nodes, edges, GROUP, e.target),
		);
	}

	/**
	 * Ungroup the selected group node(s) in the active document: clone the group's
	 * inner nodes (excluding group-input / group-output boundary nodes) into the
	 * active document, centered where the group node was, and rewire the edges.
	 *
	 * Works on both locked and unlocked groups (the source definition is never
	 * mutated - inner nodes and edges are always cloned with fresh ids).
	 */
	ungroupSelection(selectedNodeIds: Set<string>): void {
		if (this.isLocked) return;

		const groupNodes = this.activeDocument.nodes.filter(
			(n) => selectedNodeIds.has(n.id) && n.type === "node-group" && n.group,
		);
		if (groupNodes.length === 0) return;

		const freshNodeIds: string[] = [];
		for (const groupNode of groupNodes) {
			freshNodeIds.push(...this.ungroupNode(groupNode));
		}

		// Deselect everything, then select the freshly ungrouped nodes so the user
		// can immediately drag them all together.
		const freshIds = new Set(freshNodeIds);
		for (const n of this.activeDocument.nodes) n.selected = freshIds.has(n.id);
		for (const e of this.activeDocument.edges) e.selected = false;
		this.selectedNodeIds = freshNodeIds;
	}

	/**
	 * Ungroup a single group node instance living in the active document.
	 * Returns the ids of the freshly-created (cloned) inner nodes.
	 */
	private ungroupNode(groupNode: GraphNode): string[] {
		if (!groupNode.group) return [];
		const def = this.project.definitions.get(groupNode.group.definitionRef);
		if (!def) return [];

		const inputNode = def.nodes.find((n) => n.type === "group-input");
		const outputNode = def.nodes.find((n) => n.type === "group-output");
		const innerNodes = def.nodes.filter((n) => !BOUNDARY_TYPES.has(n.type ?? ""));

		// Re-center the inner nodes on the group node.
		const inner = innerNodes.length > 0 ? computeSelectionBounds(innerNodes) : undefined;
		const offset = {
			x: groupNode.position.x + (groupNode.width ?? 0) / 2 - (inner?.centerX ?? 0),
			y: groupNode.position.y + (groupNode.height ?? 0) / 2 - (inner?.centerY ?? 0),
		};
		// Edges between inner nodes come along; boundary edges are spliced below.
		const clone = cloneSubgraph(innerNodes, def.edges, offset);
		const remap = (id: string): string => clone.idMap.get(id) ?? id;

		// Outer edges connected to this group node instance.
		const incomingOuter = this.activeDocument.edgesByTarget.get(groupNode.id) ?? [];
		const outgoingOuter = this.activeDocument.edgesBySource.get(groupNode.id) ?? [];

		const boundaryEdges: GraphDocumentEdge[] = [];

		// group-input handle -> inner target. Splice: outer source -> inner target.
		for (const innerEdge of def.edges) {
			if (innerEdge.source !== inputNode?.id) continue;
			const feed = incomingOuter.find((e) => e.targetHandle === innerEdge.sourceHandle);
			if (!feed) continue; // handle not wired from outside - drop
			boundaryEdges.push({
				id: crypto.randomUUID(),
				source: feed.source,
				sourceHandle: feed.sourceHandle,
				target: remap(innerEdge.target),
				targetHandle: innerEdge.targetHandle,
			});
		}

		// inner source -> group-output handle. Splice: inner source -> outer target(s).
		for (const innerEdge of def.edges) {
			if (innerEdge.target !== outputNode?.id) continue;
			const consumers = outgoingOuter.filter(
				(e) => e.sourceHandle === innerEdge.targetHandle,
			);
			for (const consumer of consumers) {
				boundaryEdges.push({
					id: crypto.randomUUID(),
					source: remap(innerEdge.source),
					sourceHandle: innerEdge.sourceHandle,
					target: consumer.target,
					targetHandle: consumer.targetHandle,
				});
			}
		}

		const removedEdgeIds = new Set([
			...incomingOuter.map((e) => e.id),
			...outgoingOuter.map((e) => e.id),
		]);

		this.activeDocument.nodes = [
			...this.activeDocument.nodes.filter((n) => n.id !== groupNode.id),
			...clone.nodes,
		];
		indexDocument(this.activeDocument);
		this.activeDocument.edges = [
			...this.activeDocument.edges.filter((e) => !removedEdgeIds.has(e.id)),
			...clone.edges,
			...boundaryEdges,
		];
		indexDocument(this.activeDocument);

		// Rebuild types since the graph structure changed significantly
		this.rebuildTypeCache();

		return clone.nodes.map((n) => n.id);
	}

	/**
	 * Deep-clone a locked group's definition so the user gets their own editable copy.
	 * Every node and edge ID inside the clone is regenerated to prevent collisions.
	 * Returns the new definitionRef pointing to the cloned definition.
	 */
	deepClone(lockedNodeGroupId: string): string | undefined {
		// Search the whole project: the node may live in the active document,
		// an ancestor document (e.g. a breadcrumb segment), or the currently-viewed group.
		const node = this.resolveNode(lockedNodeGroupId);
		if (!node?.group) {
			console.warn(`[graph] deepClone: "${lockedNodeGroupId}" is not a group node`);
			return undefined;
		}

		const sourceDef = this.project.definitions.get(node.group.definitionRef);
		if (!sourceDef) {
			console.warn(`[graph] deepClone: missing definition "${node.group.definitionRef}"`);
			return undefined;
		}

		const newDefRef = crypto.randomUUID();
		const clone = cloneSubgraph(sourceDef.nodes, sourceDef.edges);
		this.setDefinitions([
			[
				newDefRef,
				this.hydrate({
					nodes: clone.nodes,
					edges: clone.edges,
					label: this.uniqueCopyLabel(sourceDef.label),
				}),
			],
		]);

		// Point the group node at the new (unlocked) clone
		node.group = { definitionRef: newDefRef, locked: false };

		return newDefRef;
	}

	/**
	 * Add a node of a registered type to the active document.
	 * Returns its id, or undefined if the document is locked.
	 */
	addNode(type: string, position: { x: number; y: number }): string | undefined {
		if (this.isLocked) return undefined;
		const id = crypto.randomUUID();
		const doc = this.activeDocument;
		doc.nodes = [...doc.nodes, { id, type, data: defaultDataForType(type), position }];
		indexDocument(doc);
		this.rebuildTypeCache();
		return id;
	}

	/**
	 * Create what an add-menu entry stands for at `position` (flow coordinates).
	 * Returns the id of the created node (a zone's Repeat Input), if any.
	 */
	addMenuEntry(entry: AddMenuEntry, position: { x: number; y: number }): string | undefined {
		if (entry.disabled) return undefined;
		switch (entry.kind) {
			case "zone":
				return this.createRepeatZone(position);
			case "group":
				return entry.definitionRef
					? this.addFromLibrary(entry.definitionRef, position)
					: undefined;
			case "node":
				if (entry.type === "node-group") return this.createGroup(position);
				return entry.type ? this.addNode(entry.type, position) : undefined;
		}
	}

	/**
	 * Add a node-group to the active document from an existing definition.
	 * Standard library definitions are referenced directly (locked).
	 * User-created definitions are shared across all instances (unlocked).
	 * Returns undefined if the addition would create a circular reference.
	 */
	addFromLibrary(definitionRef: string, position: { x: number; y: number }): string | undefined {
		const sourceDef = this.project.definitions.get(definitionRef);
		if (!sourceDef) {
			console.warn(`[graph] addFromLibrary: unknown definition "${definitionRef}"`);
			return undefined;
		}

		if (this.wouldCreateCycle(definitionRef)) {
			console.warn(
				`[graph] addFromLibrary: adding "${definitionRef}" would create a circular reference`,
			);
			return undefined;
		}

		const isLocked = this.isStandardLibrary(definitionRef) || sourceDef.locked;

		const groupNodeId = crypto.randomUUID();
		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position,
			group: { definitionRef, locked: isLocked },
		};

		this.activeDocument.nodes = [...this.activeDocument.nodes, groupNode];
		indexDocument(this.activeDocument);
		this.rebuildTypeCache();

		return groupNodeId;
	}

	/**
	 * Create a brand-new empty group (with one input handle and one output handle)
	 * and add an instance of it to the active document. Unlike addFromLibrary, this
	 * generates a fresh definitionRef so the node is immediately enterable and valid.
	 * Returns the new group node's id, or undefined if the active document is locked.
	 */
	createGroup(position: { x: number; y: number }): string | undefined {
		if (this.isLocked) return undefined;

		const definitionRef = crypto.randomUUID();
		const inputNodeId = crypto.randomUUID();
		const outputNodeId = crypto.randomUUID();

		const inputHandle: HandleDef = {
			id: crypto.randomUUID(),
			label: "Input 1",
			type: "f32",
		};
		const outputHandle: HandleDef = {
			id: crypto.randomUUID(),
			label: "Output 1",
			type: "f32",
		};

		const definition: GraphDocument = {
			nodes: [
				{
					id: inputNodeId,
					type: "group-input",
					data: { handles: [inputHandle] },
					position: { x: -200, y: 0 },
				},
				{
					id: outputNodeId,
					type: "group-output",
					data: { handles: [outputHandle] },
					position: { x: 200, y: 0 },
				},
			],
			edges: [
				{
					id: crypto.randomUUID(),
					source: inputNodeId,
					sourceHandle: inputHandle.id,
					target: outputNodeId,
					targetHandle: outputHandle.id,
				},
			],
			label: this.nextGroupLabel(),
		};

		this.setDefinitions([[definitionRef, this.hydrate(definition)]]);

		const groupNodeId = crypto.randomUUID();
		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position,
			group: { definitionRef, locked: false },
		};

		this.activeDocument.nodes = [...this.activeDocument.nodes, groupNode];
		indexDocument(this.activeDocument);

		// Rebuild types since a new definition and node were added
		this.rebuildTypeCache();

		return groupNodeId;
	}

	/** Generate the next "Group N" label based on existing user definitions. */
	private nextGroupLabel(): string {
		const count = [...this.project.definitions.keys()].filter(
			(k) => !this.isStandardLibrary(k),
		).length;
		return `Group ${String(count)}`;
	}

	/** Set the display label for a group definition (shared by all instances). */
	setGroupLabel(nodeId: string, label: string) {
		let node: GraphNode | undefined;
		if (this.path.length > 0) {
			node = this.parentDocument.nodesById.get(nodeId);
		}
		node ??= this.activeDocument.nodesById.get(nodeId);
		if (!node?.group) return;
		const def = this.project.definitions.get(node.group.definitionRef);
		if (!def) return;
		const trimmed = label.trim();
		if (!trimmed) return;
		if (!this.isLabelAvailable(trimmed, node.group.definitionRef)) return;
		def.label = trimmed;
	}

	/** Check whether a label is available (not used by any node type, the standard library, or other definitions). */
	isLabelAvailable(label: string, excludeDefRef?: string): boolean {
		const trimmed = label.trim();
		if (!trimmed) return false;
		for (const desc of Object.values(nodeRegistry)) {
			if (desc.label === trimmed) return false;
		}
		for (const entry of this.library) {
			if (entry.label && entry.label === trimmed) return false;
		}
		for (const [key, def] of this.project.definitions.entries()) {
			if (key === excludeDefRef) continue;
			if (def.label === trimmed) return false;
		}
		return true;
	}

	/**
	 * Permanently delete a group definition and every instance that references it
	 * across the whole project. Standard library definitions cannot be deleted.
	 * No-op if the definition is still referenced anywhere (use after confirming
	 * it's an orphaned entry).
	 */
	deleteDefinition(definitionRef: string) {
		if (definitionRef === ROOT_ID) return;
		if (this.isStandardLibrary(definitionRef)) return;
		if (!this.project.definitions.has(definitionRef)) return;

		const referenced = [...this.project.definitions.values()].some((doc) =>
			groupRefsOf(doc).includes(definitionRef),
		);
		if (referenced) return;
		this.removeDefinitions([definitionRef]);
	}

	/**
	 * Compute every user-created (non-standard-library) group definition that is
	 * not reachable from any "live" part of the project. A definition is live if
	 * it is a standard-library entry, or if it is referenced (directly or
	 * transitively) by a node-group instance that lives in the root document or
	 * in another live definition.
	 *
	 * This is a *deep* reachability check: if group A is only referenced by group
	 * B, and group B itself is unused, then A is also unreachable and prunable.
	 *
	 * Returns the definition refs that *would* be removed (and are therefore safe
	 * to delete without leaving dangling references). Does not mutate anything.
	 */
	getPrunableRefs(): string[] {
		// Live = standard library + anything reachable from the root document.
		const live = this.reachableUserRefs(groupRefsOf(this.root));
		return [...this.project.definitions.keys()].filter(
			(key) => key !== ROOT_ID && !this.isStandardLibrary(key) && !live.has(key),
		);
	}

	/** A preview of groups that `pruneUnusedDefinitions` would delete. */
	getPrunableGroups(): { ref: string; label: string; nodeCount: number }[] {
		return this.getPrunableRefs().map((ref) => {
			const def = this.project.definitions.get(ref);
			const nodeCount = def
				? def.nodes.filter((n) => !BOUNDARY_TYPES.has(n.type ?? "")).length
				: 0;
			return { ref, label: def?.label ?? "Group", nodeCount };
		});
	}

	/**
	 * Remove every user-created (non-standard-library) group definition that is
	 * no longer referenced by any group node instance anywhere in the project,
	 * including definitions that only reference each other in a cycle of orphans.
	 * Returns the list of definition refs that were removed.
	 */
	pruneUnusedDefinitions(): string[] {
		if (this.isLocked) return [];

		const removed = this.getPrunableRefs();
		if (removed.length === 0) return [];

		this.removeDefinitions(removed);
		return removed;
	}

	/** Update the label of a handle on a group-input or group-output node inside a definition.
	 *  Rejects the change if another handle on the same boundary node already has that label.
	 *  Returns true if the label was updated, false if rejected. */
	setHandleLabel(
		definitionRef: string,
		handleNodeId: string,
		handleId: string,
		label: string,
	): boolean {
		const def = this.project.definitions.get(definitionRef);
		if (!def) return false;
		const handleNode = def.nodesById.get(handleNodeId);
		if (!handleNode) return false;
		const handles = handleNode.data.handles as HandleDef[] | undefined;
		if (!handles) return false;
		const handle = handles.find((h) => h.id === handleId);
		if (!handle) return false;

		const trimmed = label.trim();
		if (!trimmed) return false;

		// Reject duplicate labels within the same boundary node
		if (handles.some((h) => h.id !== handleId && h.label === trimmed)) return false;

		handle.label = trimmed;
		return true;
	}

	// ── Label helpers ───────────────────────────────────────────────────────

	/**
	 * Resolve the display labels for a node's handles directly from the source
	 * definitions. Used by NodeShell so label edits are visible immediately.
	 */
	resolveNodeLabels(nodeId: string): {
		inputs: Record<string, string>;
		outputs: Record<string, string>;
	} {
		const inputs: Record<string, string> = {};
		const outputs: Record<string, string> = {};

		const node = this.resolveNode(nodeId);
		if (!node) return { inputs, outputs };

		if (node.type === "group-input") {
			for (const h of handlesOf(node)) outputs[h.id] = h.label;
		} else if (node.type === "group-output") {
			for (const h of handlesOf(node)) inputs[h.id] = h.label;
		} else if (node.type === "node-group" && node.group) {
			const def = this.project.definitions.get(node.group.definitionRef);
			if (def) {
				const inputNode = def.nodes.find((n) => n.type === "group-input");
				const outputNode = def.nodes.find((n) => n.type === "group-output");
				for (const h of handlesOf(inputNode)) inputs[h.id] = h.label;
				for (const h of handlesOf(outputNode)) outputs[h.id] = h.label;
			}
		}

		return { inputs, outputs };
	}

	// ── Type override helpers ───────────────────────────────────────────────

	/**
	 * Resolve the effective type for an input handle on a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveInputType(nodeId: string, inputId: string): WgslType {
		const node = this.resolveNode(nodeId);
		if (!node) return "f32";

		const descriptor = this.resolveDescriptor(node);
		const inputDef = descriptor.inputs.find((i) => i.id === inputId);
		if (!inputDef) return "f32";

		// Check cache first
		const cached = this.typeCache.get(nodeId);
		if (cached) {
			return cached.inputTypes[inputId] ?? inputDef.types[0] ?? "f32";
		}

		// Fallback: compute on the fly (shouldn't happen after initial cache build)
		const incoming = this.activeDocument.edgesByTarget.get(nodeId) ?? [];
		const result = this.typeResolver.resolveNodeTypes(node, incoming, (id) =>
			this.resolveNode(id),
		);
		return result.inputTypes[inputId] ?? inputDef.types[0] ?? "f32";
	}

	/**
	 * Resolve the output type for a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveNodeOutputType(nodeId: string): WgslType {
		const cached = this.typeCache.get(nodeId);
		if (cached) return cached.outputType;

		// Fallback: compute on the fly
		const node = this.resolveNode(nodeId);
		if (!node) return "f32";
		const incoming = this.activeDocument.edgesByTarget.get(nodeId) ?? [];
		const result = this.typeResolver.resolveNodeTypes(node, incoming, (id) =>
			this.resolveNode(id),
		);
		return result.outputType;
	}

	/**
	 * The type an input would get from its links alone, ignoring the type the
	 * user forced on the node.
	 */
	resolveInferredInputType(nodeId: string, inputId: string): WgslType {
		const forced = this.resolveInputType(nodeId, inputId); // also tracks the type cache
		const node = this.resolveNode(nodeId);
		if (!node?.data.__nodeTypeOverrides) return forced;
		const data = { ...node.data };
		delete data.__nodeTypeOverrides;
		const incoming = this.activeDocument.edgesByTarget.get(nodeId) ?? [];
		const result = this.typeResolver.resolveNodeTypesUncached(node, incoming, data, (id) =>
			this.resolveNode(id),
		);
		return result.inputTypes[inputId] ?? forced;
	}

	/**
	 * Resolve the type carried by one output handle of a node.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveOutputHandleType(nodeId: string, handleId: string): WgslType {
		const outputs = this.resolveNodeOutputs(nodeId);
		return outputs.find((o) => o.id === handleId)?.type ?? this.resolveNodeOutputType(nodeId);
	}

	/**
	 * Resolve the active inputs for a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveNodeInputs(nodeId: string): NodeInputDef[] {
		const cached = this.typeCache.get(nodeId);
		if (cached) return cached.resolvedInputs;

		// Fallback: compute on the fly
		const node = this.resolveNode(nodeId);
		if (!node) return [];
		const incoming = this.activeDocument.edgesByTarget.get(nodeId) ?? [];
		const result = this.typeResolver.resolveNodeTypes(node, incoming, (id) =>
			this.resolveNode(id),
		);
		return result.resolvedInputs;
	}

	/**
	 * Resolve the active outputs for a node instance.
	 * Reads from the memoised type cache (single source of truth).
	 */
	resolveNodeOutputs(nodeId: string): NodeOutputDef[] {
		const cached = this.typeCache.get(nodeId);
		if (cached) return cached.resolvedOutputs;

		// Fallback: compute on the fly
		const node = this.resolveNode(nodeId);
		if (!node) return [];
		const incoming = this.activeDocument.edgesByTarget.get(nodeId) ?? [];
		const result = this.typeResolver.resolveNodeTypes(node, incoming, (id) =>
			this.resolveNode(id),
		);
		return result.resolvedOutputs;
	}

	// ── Node data edits ─────────────────────────────────────────────────────

	/**
	 * Merge `patch` into a node's data in the active document (`undefined`
	 * removes a key). The node object is replaced, never mutated, so front
	 * ends notice. Types are re-resolved unless `retype` is false (plain value
	 * edits, e.g. while scrubbing).
	 */
	updateNodeData(nodeId: string, patch: Record<string, unknown>, { retype = true } = {}) {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node) return;
		const data = Object.fromEntries(
			Object.entries({ ...node.data, ...patch }).filter(([, value]) => value !== undefined),
		);
		this.patchNodeData(new Map([[nodeId, data]]));
		if (retype) this.invalidateTypes([nodeId]);
	}

	/**
	 * What a node's type picker offers: the types of its family, the type the
	 * user forced (if any) and the type its links infer. Undefined for nodes
	 * without a choice of types.
	 */
	typeChoice(nodeId: string): TypeChoice | undefined {
		const node = this.resolveNode(nodeId);
		if (!node || node.type === "node-group") return undefined;
		const descriptor = this.resolveDescriptor(node);
		const primary =
			descriptor.inputs.find((i) => i.id === descriptor.primaryInput) ?? descriptor.inputs[0];
		const family = descriptor.typeFamily;
		const types = family?.types ?? primary?.types ?? [];
		if (types.length < 2) return undefined;
		const forced = family ? node.data[family.key] : typeOverrides(node)[familyKey(types)];
		return {
			types,
			inferable: !family && types.length > 1,
			forced: isWgslType(forced) ? forced : undefined,
			inferred: family
				? this.resolveNodeOutputType(nodeId)
				: primary
					? this.resolveInferredInputType(nodeId, primary.id)
					: "f32",
		};
	}

	/** Force a node's type (see `typeChoice`), or go back to inference with `undefined`. */
	setNodeType(nodeId: string, type: WgslType | undefined) {
		const node = this.activeDocument.nodesById.get(nodeId);
		const choice = this.typeChoice(nodeId);
		if (!node || !choice) return;
		const family = this.resolveDescriptor(node).typeFamily;
		if (family) {
			this.updateNodeData(nodeId, { [family.key]: type });
			return;
		}
		const overrides = { ...typeOverrides(node), [familyKey(choice.types)]: type };
		const kept = Object.entries(overrides).filter(([, t]) => t !== undefined);
		this.updateNodeData(nodeId, {
			__nodeTypeOverrides: kept.length > 0 ? Object.fromEntries(kept) : undefined,
		});
	}

	/** Add a handle to a group-input / group-output node of the active document. */
	addHandle(nodeId: string, type: WgslType): HandleDef | undefined {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node || !BOUNDARY_TYPES.has(node.type ?? "")) return undefined;
		const handles = handlesOf(node);
		const handle: HandleDef = {
			id: crypto.randomUUID(),
			label: `Handle ${String(handles.length + 1)}`,
			type,
		};
		this.updateNodeData(nodeId, { handles: [...handles, handle], [handle.id]: 0 });
		return handle;
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

		// Recompute types for all invalidated nodes
		for (const nodeId of invalidated) {
			const node = this.resolveNode(nodeId);
			if (!node) continue;
			const incoming = allEdges.filter((e) => e.target === nodeId);
			const result = this.typeResolver.resolveNodeTypes(node, incoming, (id) =>
				this.resolveNode(id),
			);
			this.typeCache.set(nodeId, result);
		}

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

		// Trigger reactivity by creating a new Map reference
		this.typeCache = new Map(this.typeCache);
	}

	/**
	 * Rebuild the entire type cache from scratch. Called on project load
	 * and when the document structure changes fundamentally.
	 */
	rebuildTypeCache(): void {
		// Clear the TypeResolver's memoisation cache so every node is recomputed
		this.typeResolver.clearCache();

		this.typeCache = new Map();

		// Compute types for all nodes across all documents
		for (const doc of this.project.definitions.values()) {
			this.typeResolver.computeAll(doc.nodes, doc.edges, (id) => this.resolveNode(id));
		}

		// Copy resolved types into the reactive cache
		for (const [nodeId, result] of this.typeResolver.cache) {
			this.typeCache.set(nodeId, result);
		}

		// Trigger reactivity
		this.typeCache = new Map(this.typeCache);
	}

	/**
	 * Change the type of a handle on a group-input / group-output node. Links
	 * that no longer fit (inside the definition, and on every instance of the
	 * group) are removed.
	 */
	setHandleType(definitionRef: string, handleNodeId: string, handleId: string, type: WgslType) {
		const def = this.project.definitions.get(definitionRef);
		const handleNode = def?.nodesById.get(handleNodeId);
		const handles = handleNode?.data.handles as HandleDef[] | undefined;
		if (!def || !handleNode || !handles?.some((h) => h.id === handleId)) return;

		const data = {
			...handleNode.data,
			handles: handles.map((h) => (h.id === handleId ? { ...h, type } : h)),
		};
		def.nodes = def.nodes.map((n) => (n.id === handleNodeId ? { ...n, data } : n));
		indexDocument(def);
		this.rebuildTypeCache();

		const touches = (doc: HydratedGraphDocument, e: GraphEdge) => {
			if (doc === def) {
				return (
					(e.source === handleNodeId && e.sourceHandle === handleId) ||
					(e.target === handleNodeId && e.targetHandle === handleId)
				);
			}
			const isInstance = (id: string) =>
				doc.nodesById.get(id)?.group?.definitionRef === definitionRef;
			return (
				(isInstance(e.source) && e.sourceHandle === handleId) ||
				(isInstance(e.target) && e.targetHandle === handleId)
			);
		};
		for (const doc of this.project.definitions.values()) {
			const kept = doc.edges.filter((e) => {
				if (!touches(doc, e)) return true;
				const source = doc.nodesById.get(e.source);
				const target = doc.nodesById.get(e.target);
				return (
					!!source &&
					!!target &&
					this.isTypeCompatible(source, e.sourceHandle, target, e.targetHandle)
				);
			});
			if (kept.length !== doc.edges.length) {
				doc.edges = kept;
				indexDocument(doc);
			}
		}
		this.rebuildTypeCache();
	}

	/** Remove a handle from a group-input/group-output node and delete all connected edges. */
	removeHandle(definitionRef: string, handleNodeId: string, handleId: string) {
		const def = this.project.definitions.get(definitionRef);
		if (!def) return;

		// Remove the handle from the node's data
		const handleNode = def.nodesById.get(handleNodeId);
		if (!handleNode) return;
		const handles = handleNode.data.handles as HandleDef[] | undefined;
		if (!handles) return;
		const idx = handles.findIndex((h) => h.id === handleId);
		if (idx === -1) return;
		handles.splice(idx, 1);

		// Remove all internal edges connected to this handle on this node
		def.edges = def.edges.filter(
			(e) =>
				!(
					(e.source === handleNodeId && e.sourceHandle === handleId) ||
					(e.target === handleNodeId && e.targetHandle === handleId)
				),
		);
		indexDocument(def);

		// Remove all *outer* edges in any document that holds an instance of this
		// definition: the now-deleted handle no longer exists on the group node,
		// so any edge referencing it would be dangling and crash the renderer.
		this.removeOuterEdgesForHandle(definitionRef, handleId);

		// Rebuild types since handles and cross-document edges changed
		this.rebuildTypeCache();
	}

	/**
	 * Delete every edge in the project that connects to a group node instance of
	 * `definitionRef` via the given `handleId`. Without this, deleting a handle
	 * from a group's definition leaves dangling edges in parent documents.
	 */
	private removeOuterEdgesForHandle(definitionRef: string, handleId: string) {
		const documents = this.project.definitions.values();
		for (const doc of documents) {
			const instanceIds = doc.nodes
				.filter((n) => n.type === "node-group" && n.group?.definitionRef === definitionRef)
				.map((n) => n.id);
			if (instanceIds.length === 0) continue;
			const ids = new Set(instanceIds);
			doc.edges = doc.edges.filter(
				(e) =>
					!(
						(ids.has(e.source) && e.sourceHandle === handleId) ||
						(ids.has(e.target) && e.targetHandle === handleId)
					),
			);
			indexDocument(doc);
		}
	}
}

/** A link being dragged from a handle, not dropped on another handle yet. */
export type PendingConnection = {
	nodeId: string;
	handleId: string;
	/** "source" when dragged from an output, "target" when dragged from an input. */
	handleType: "source" | "target";
};

/** Approximate rendered node width, for placing nodes next to a drop point. */
const NODE_WIDTH = 180;
/** Horizontal distance between a new zone's input and output nodes. */
const ZONE_SPACING = 450;
