import { convertColorMode } from "../color";
import { MATCH, isCaseHandle } from "../enums";
import {
	ARCHIVED_VERSIONS_ENABLED,
	loadArchivedVersion,
	parseLibraryRef,
	standardLibrary,
} from "../library";
import { nodeRegistry } from "../nodes/registry";
import {
	type InputValue,
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeOutputDef,
	type NodeWidget,
	type WgslType,
	enumValue,
	familyKey,
	isConnectionCompatible,
} from "../types";
import { TypeResolver } from "../types/resolver";
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
import { readComponent } from "./values";

export type ResolvedTypes = {
	inputTypes: Record<string, WgslType>;
	outputType: WgslType;
	resolvedInputs: NodeInputDef[];
	resolvedOutputs: NodeOutputDef[];
};

export type GraphModelState = {
	project: HydratedGraphProject;
	path: string[];
	selectedNodeIds: string[];
	typeCache: Map<string, ResolvedTypes>;
};

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

	// ── State ───────────────────────────────────────────────────────────────────

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

	// ── Documents ───────────────────────────────────────────────────────────────

	/**
	 * Replace the whole project: hydrate it, register the standard library
	 * definitions next to it (so group nodes can reference them), and rebuild
	 * the type resolver and type cache for the new definitions.
	 */
	protected setProject(project: GraphProject) {
		this.project = hydrateProject(project, () => this.createDocument());
		for (const entry of this.library) this.registerLibraryEntry(entry.ref, entry);
		this.registerLibraryRefs();
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
	protected *walkPath(): Generator<{
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

	/** The key of the active document in `project.definitions`. */
	get activeDefinitionRef(): string {
		let ref = ROOT_ID;
		for (const { group } of this.walkPath()) ref = group.definitionRef;
		return ref;
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
		const overrideType = targetNode.data.types?.[familyKey(targetInputDef.types)];
		if (overrideType) return isConnectionCompatible(sourceType, overrideType);

		// Valid if the source can be converted to any type within the family
		return targetInputDef.types.some((t) => isConnectionCompatible(sourceType, t));
	}

	/** Replace the data of some nodes of the active document (reactively). */
	protected patchNodeData(patches: Map<string, NodeData>) {
		const doc = this.activeDocument;
		doc.nodes = doc.nodes.map((n) => {
			const data = patches.get(n.id);
			return data ? { ...n, data } : n;
		});
		indexDocument(doc);
	}

	/** Whether the currently-viewed subgraph (or any of its ancestors) is locked. */
	get isLocked(): boolean {
		for (const { group } of this.walkPath()) {
			if (group.locked) return true;
		}
		return false;
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
		if (!node?.data.types) return forced;
		const data = { ...node.data, types: undefined };
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
		this.dropStaleCaseLinks();

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
	 * Merge `patch` into a node's data in the active document (`undefined`
	 * clears a field). The node object is replaced, never mutated, so front
	 * ends notice. Types are re-resolved unless `retype` is false (plain value
	 * edits, e.g. while scrubbing).
	 */
	updateNodeData(nodeId: string, patch: Partial<NodeData>, { retype = true } = {}) {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node) return;
		const data: NodeData = { ...node.data, ...patch };
		this.patchNodeData(new Map([[nodeId, data]]));
		if (retype) this.invalidateTypes([nodeId]);
	}

	/** Set the value an input holds while unlinked (`undefined` clears it). */
	setInputValue(nodeId: string, inputId: string, value: InputValue | undefined) {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node) return;
		const values = withEntry(node.data.values, inputId, value);
		const widget = this.resolveDescriptor(node).widget;
		const converted = widget?.mode === inputId ? this.keepColor(node, widget, values) : values;
		this.updateNodeData(nodeId, { values: converted }, { retype: false });
	}

	/**
	 * `values` with a colour widget's components converted to its new mode,
	 * so the colour stays the same (unlike Blender's Combine Color, which
	 * keeps the numbers). Only possible while none is linked: a linked one's
	 * value is only known in the shader.
	 */
	private keepColor(
		node: GraphNode,
		widget: NodeWidget,
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
		const linked = new Set(
			(this.activeDocument.edgesByTarget.get(node.id) ?? []).map((e) => e.targetHandle),
		);
		if (!from || !to || from === to || widget.components.some((c) => linked.has(c))) {
			return values;
		}
		const read = (c: string) => readComponent(values?.[c] ?? defaults?.[c], "_");
		const [x, y, z] = widget.components.map(read);
		const next = convertColorMode(from, to, [x ?? 0, y ?? 0, z ?? 0]);
		const converted = { ...values };
		widget.components.forEach((c, i) => {
			converted[c] = next[i] ?? 0;
		});
		return converted;
	}

	/** Pick an option of one of the node's settings. */
	setSetting(nodeId: string, key: string, value: string) {
		const node = this.activeDocument.nodesById.get(nodeId);
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
