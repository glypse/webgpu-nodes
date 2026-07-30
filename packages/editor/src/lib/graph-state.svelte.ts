import type { Node, Edge } from "@xyflow/svelte";
import { getContext, setContext } from "svelte";
import * as v from "valibot";

import defaultScene from "./defaultProject.json";
import {
	buildDocumentIndex,
	hydrateDocument,
	hydrateProject,
	normaliseDocument,
	resolveDescriptor,
	serialiseDocument,
} from "./graph-helpers";
import { GraphProjectSchema, StandardLibraryEntriesSchema } from "./graph-schema";
import {
	type GraphDocument,
	type GraphDocumentEdge,
	type GraphDocumentNode,
	type GraphProject,
	type HydratedEdge,
	type HydratedGraphProject,
	ROOT_ID,
	type StandardLibraryEntry,
} from "./graph-types";
import { type HydratedGraphDocument } from "./hydrated-document.svelte";
import { nodeRegistry } from "./registry";
import { TypeResolver } from "./type-resolver";
import {
	type GroupedNode,
	type HandleDef,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeOutputDef,
	type WgslType,
	isConnectionCompatible,
} from "./types";

// ── Standard library auto-import ──────────────────────────────────────────────

const libraryModules = import.meta.glob<{
	default: {
		id: string;
		name: string;
		category: string;
		dependencies: string[];
		definition: GraphDocument;
	};
}>("./standard-library/*.json", { eager: true });

const libraryEntries: StandardLibraryEntry[] = Object.values(libraryModules).map((mod) => {
	const entry = mod.default;
	return {
		id: entry.id,
		label: entry.name,
		category: entry.category,
		dependencies: entry.dependencies,
		definition: entry.definition,
	};
});

// ── Reactive state manager ───────────────────────────────────────────────────

export class GraphManager {
	/** The entire project tree. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map is reassigned, not mutated
	project = $state<HydratedGraphProject>({ definitions: new Map() });

	/** Shortcut for the root document. Always exists after construction. */
	get root(): HydratedGraphDocument {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ROOT_ID is always present
		return this.project.definitions.get(ROOT_ID)!;
	}

	/**
	 * Breadcrumb path of group-node ids from root down to the currently-viewed subgraph.
	 * [] means "viewing root". ["node-7"] means "viewing node-7's content".
	 * ["node-7", "node-12"] means nested two levels deep.
	 */
	path = $state<string[]>([]);

	/** Currently selected node IDs in SvelteFlow. */
	selectedNodeIds = $state<string[]>([]);

	/**
	 * Group configuration sheet state. Opened via the "n" key (see GraphContent)
	 * or the faders button on group / group-input / group-output nodes (see NodeShell).
	 * `sheetGroupId` is the id of the group node *instance* whose definition is being edited.
	 */
	sheetOpen = $state(false);
	sheetGroupId = $state<string | null>(null);

	/** Open (or toggle closed) the group configuration sheet for a group node instance. */
	openGroupSheet(targetNodeId: string) {
		if (this.sheetOpen && this.sheetGroupId === targetNodeId) {
			this.sheetOpen = false;
		} else {
			this.sheetGroupId = targetNodeId;
			this.sheetOpen = true;
		}
	}

	/** Read-only standard library entries for browsing. */
	library: StandardLibraryEntry[] = libraryEntries;

	/** Centralised type resolver — single source of truth for all type resolution. */
	typeResolver: TypeResolver;

	/**
	 * Reactive cache of resolved types per node. Keyed by node ID.
	 * Components read from this for type badges, dropdowns, and output labels.
	 * Updated via `invalidateTypes` after graph mutations.
	 */
	typeCache = $state<
		Map<
			string,
			{
				inputTypes: Record<string, WgslType>;
				outputType: WgslType;
				resolvedInputs: NodeInputDef[];
				resolvedOutputs: NodeOutputDef[];
			}
		>
	>(
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		new Map(),
	);

	constructor(defaults?: GraphProject) {
		const project: GraphProject = defaults ?? defaultScene;
		this.project = hydrateProject(project);

		// Register standard library definitions so they can be referenced by group nodes
		for (const entry of this.library) {
			const def = normaliseDocument(entry.definition);
			def.label = entry.label;
			this.project.definitions.set(entry.id, hydrateDocument(def));
		}

		this.typeResolver = new TypeResolver(
			(n) => this.resolveDescriptor(n),
			this.project.definitions,
			(id) => this.getIncomingEdges(id),
		);
		this.rebuildTypeCache();
	}

	/**
	 * Look up any node by ID across all documents in the project.
	 * Used as the `resolveNode` callback for the TypeResolver.
	 */
	resolveNode(nodeId: string): GroupedNode | undefined {
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
	private getIncomingEdges(nodeId: string): HydratedEdge[] {
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
		node: GroupedNode;
		group: NonNullable<GroupedNode["group"]>;
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

	resolveDescriptor(node: GroupedNode | Node): NodeDescriptor {
		return resolveDescriptor(node, this.project.definitions);
	}

	/**
	 * Public wrapper used by SvelteFlow's `isValidConnection` prop. Validates a
	 * prospective edge against the WGSL type system: a higher-N value cannot be
	 * fed into a lower-N input (the user must decompose it first).
	 */
	isValidConnection(connection: {
		source?: string | null;
		sourceHandle?: string | null;
		target?: string | null;
		targetHandle?: string | null;
	}): boolean {
		if (!connection.source || !connection.target) return false;

		const sourceNode = this.resolveNode(connection.source);
		const targetNode = this.resolveNode(connection.target);
		if (!sourceNode || !targetNode) return false;

		const sourceType = this.typeResolver.inferHandleType(
			{
				source: connection.source,
				sourceHandle: connection.sourceHandle ?? "",
				target: "",
				targetHandle: "",
				id: "",
			},
			(id) => this.resolveNode(id),
		);

		const targetDescriptor = this.resolveDescriptor(targetNode);

		// For nodes with resolveInputs, validate against active inputs only
		if (targetDescriptor.resolveInputs && targetDescriptor.typeFamily) {
			const override = targetNode.data[targetDescriptor.typeFamily.key] as
				| WgslType
				| undefined;
			const outputType = override ?? targetDescriptor.typeFamily.types[0] ?? "f32";
			const activeInputs = targetDescriptor.resolveInputs(outputType);
			const targetInputDef = activeInputs.find((i) => i.id === connection.targetHandle);
			if (!targetInputDef) return false;
			return isConnectionCompatible(sourceType, targetInputDef.types[0] ?? "f32");
		}

		const targetEdgeIncoming = targetDescriptor.inputs.length === 1 && !connection.targetHandle;
		const targetInputDef = targetDescriptor.inputs.find(
			(i) => i.id === connection.targetHandle || targetEdgeIncoming,
		);
		if (!targetInputDef) return false;

		// If the target has a node-wide override, validate against that specific type
		const nodeOverrides = targetNode.data.__nodeTypeOverrides as
			| Record<string, WgslType>
			| undefined;
		const familyKey = targetInputDef.types.join(",");
		const overrideType = nodeOverrides?.[familyKey];
		if (overrideType) {
			return isConnectionCompatible(sourceType, overrideType);
		}

		// Check against the type family — connection is valid if the source can
		// be promoted to any type within the family (up to the highest member)
		return targetInputDef.types.some((t) => isConnectionCompatible(sourceType, t));
	}

	get nodes(): GroupedNode[] {
		return this.activeDocument.nodes;
	}
	set nodes(value: GroupedNode[]) {
		this.activeDocument.nodes = value;
		this.rebuildDocumentIndex(this.activeDocument);
	}
	get edges(): HydratedEdge[] {
		return this.activeDocument.edges;
	}
	set edges(value: Edge[]) {
		this.activeDocument.edges = value as HydratedEdge[];
		this.rebuildDocumentIndex(this.activeDocument);
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
		this.project = hydrateProject(parsed.output);
		this.path = [];

		// Re-register standard library definitions after loading
		for (const entry of this.library) {
			const def = normaliseDocument(entry.definition);
			def.label = entry.label;
			this.project.definitions.set(entry.id, hydrateDocument(def));
		}

		// Rebuild the type resolver with the new definitions and recompute all types
		this.typeResolver = new TypeResolver(
			(n) => this.resolveDescriptor(n),
			this.project.definitions,
			(id) => this.getIncomingEdges(id),
		);
		this.rebuildTypeCache();

		return true;
	}

	getProjectJson(): string {
		const definitions = Object.fromEntries(
			[...this.project.definitions.entries()].map(([key, definition]) => [
				key,
				serialiseDocument(
					definition.nodes,
					definition.edges,
					definition.label,
					definition.locked,
					definition.viewport,
				),
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

	save() {
		const blob = new Blob([this.getProjectJson()], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "webGpuNodesProject.json";
		a.click();
		URL.revokeObjectURL(url);
	}

	async upload(file: File): Promise<boolean> {
		try {
			const text = await file.text();
			return this.loadFromString(text);
		} catch (err) {
			console.error("[graph] failed to parse uploaded JSON", err);
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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const refs = new Set<string>();
		for (const { group } of this.walkPath()) {
			refs.add(group.definitionRef);
		}
		return refs;
	}

	/**
	 * Collect all definitionRefs transitively referenced by a definition
	 * (excluding standard library refs, which can't create cycles).
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pure algorithm helper
	private transitiveRefs(definitionRef: string, visited = new Set<string>()): Set<string> {
		if (visited.has(definitionRef) || this.isStandardLibrary(definitionRef)) return visited;
		visited.add(definitionRef);
		const def = this.project.definitions.get(definitionRef);
		if (!def) return visited;
		for (const node of def.nodes) {
			if (node.type === "node-group" && node.group) {
				this.transitiveRefs(node.group.definitionRef, visited);
			}
		}
		return visited;
	}

	/**
	 * Check whether adding an instance of `definitionRef` at the current path
	 * would create a circular reference (directly or transitively).
	 */
	wouldCreateCycle(definitionRef: string): boolean {
		const inScope = this.collectInScopeRefs();
		if (inScope.size === 0) return false;
		const refs = this.transitiveRefs(definitionRef);
		for (const ref of refs) {
			if (inScope.has(ref)) return true;
		}
		return false;
	}

	/** Collect every label currently in use (standard library + all definitions). */
	private usedLabels(): Set<string> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pure algorithm helper
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

	/**
	 * Collect all nested group definitionRefs referenced by a definition.
	 * Does NOT include standard library refs (they're always available).
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pure algorithm helper, not reactive state
	private collectNestedRefs(definitionRef: string, visited = new Set<string>()): string[] {
		if (visited.has(definitionRef) || this.isStandardLibrary(definitionRef)) return [];
		visited.add(definitionRef);

		const def = this.project.definitions.get(definitionRef);
		if (!def) return [];

		const refs: string[] = [];
		for (const node of def.nodes) {
			if (node.type === "node-group" && node.group) {
				refs.push(node.group.definitionRef);
				refs.push(...this.collectNestedRefs(node.group.definitionRef, visited));
			}
		}
		return refs;
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
			definition: {
				nodes: def.nodes.map((n) => ({
					id: n.id,
					type: n.type ?? "",
					data: JSON.parse(JSON.stringify(n.data)) as Record<string, unknown>,
					position: { ...n.position },
					...(n.group ? { group: { ...n.group } } : {}),
				})),
				edges: def.edges.map((e) => ({
					id: e.id,
					source: e.source,
					target: e.target,
					sourceHandle: e.sourceHandle,
					targetHandle: e.targetHandle,
				})),
			},
		};
	}

	/** Trigger a browser download of a single JSON file. */
	private downloadJson(filename: string, data: unknown) {
		const blob = new Blob([JSON.stringify(data, null, "\t")], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Export a single group (and all its nested dependencies) to downloadable JSON files.
	 * Nested groups are exported as separate files. Standard library deps are skipped.
	 */
	exportGroup(definitionRef: string) {
		const refs = [definitionRef, ...this.collectNestedRefs(definitionRef)];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local dedup, not reactive state
		const uniqueRefs = [...new Set(refs)];

		for (const ref of uniqueRefs) {
			const entry = this.buildExportEntry(ref);
			if (!entry) continue;
			const slug = entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			this.downloadJson(`${slug}.json`, entry);
		}
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
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
			this.project.definitions = new Map(this.project.definitions).set(
				file.id,
				hydrateDocument(normalised),
			);
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
		// TODO: temporarily exclude uv nodes from grouping - revisit once subgraph wiring supports them
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const UNGROUPABLE_TYPES = new Set(["frag-output", "uv", "group-input", "group-output"]);

		const selectedNodes = this.activeDocument.nodes.filter(
			(node) => selectedNodeIds.has(node.id) && !UNGROUPABLE_TYPES.has(node.type ?? ""),
		);

		if (selectedNodes.length === 0 || selectedNodes.every((n) => n.type === "node-group")) {
			return;
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const filteredIds = new Set(selectedNodes.map((n) => n.id));
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

		const userGroupCount = [...this.project.definitions.keys()].filter(
			(k) => !this.isStandardLibrary(k),
		).length;

		const definition: GraphDocument = {
			nodes: [
				...(selectedNodes as GraphDocumentNode[]),
				groupInputNode.node,
				groupOutputNode.node,
			],
			edges: [...internal, ...allInnerEdges],
			label: `Group ${String(userGroupCount)}`,
		};

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		this.project.definitions = new Map(this.project.definitions).set(
			definitionRef,
			hydrateDocument(definition),
		);

		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position: { x: bounds.centerX, y: bounds.centerY },
			group: { definitionRef, locked: false },
		};

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const touchedEdgeIds = new Set([
			...internal.map((e) => e.id),
			...incoming.map((e) => e.id),
			...outgoing.map((e) => e.id),
		]);

		this.activeDocument.nodes = [
			...this.activeDocument.nodes.filter((n) => !filteredIds.has(n.id)),
			groupNode,
		];
		this.rebuildDocumentIndex(this.activeDocument);

		this.activeDocument.edges = [
			...this.activeDocument.edges.filter((e) => !touchedEdgeIds.has(e.id)),
			...allOuterEdges,
		];
		this.rebuildDocumentIndex(this.activeDocument);

		// Clear SvelteFlow's internal selection state so moved nodes/edges
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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local set, not reactive state
		const freshIds = new Set(freshNodeIds);
		for (const n of this.activeDocument.nodes) n.selected = freshIds.has(n.id);
		for (const e of this.activeDocument.edges) e.selected = false;
		this.selectedNodeIds = freshNodeIds;
	}

	/**
	 * Ungroup a single group node instance living in the active document.
	 * Returns the ids of the freshly-created (cloned) inner nodes.
	 */
	private ungroupNode(groupNode: GroupedNode): string[] {
		if (!groupNode.group) return [];
		const def = this.project.definitions.get(groupNode.group.definitionRef);
		if (!def) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const BOUNDARY = new Set(["group-input", "group-output"]);
		const inputNode = def.nodes.find((n) => n.type === "group-input");
		const outputNode = def.nodes.find((n) => n.type === "group-output");
		const innerNodes = def.nodes.filter((n) => !BOUNDARY.has(n.type ?? ""));

		// Regenerate ids for every inner node.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local id map, not reactive state
		const idMap = new Map<string, string>();
		for (const n of innerNodes) idMap.set(n.id, crypto.randomUUID());

		// Compute the center of the inner nodes so we can re-center them on the group node.
		const groupCenterX = groupNode.position.x + (groupNode.width ?? 0) / 2;
		const groupCenterY = groupNode.position.y + (groupNode.height ?? 0) / 2;

		const lefts = innerNodes.map((n) => n.position.x);
		const tops = innerNodes.map((n) => n.position.y);
		const rights = innerNodes.map((n) => n.position.x + (n.width ?? 0));
		const bottoms = innerNodes.map((n) => n.position.y + (n.height ?? 0));
		const innerCenterX =
			innerNodes.length > 0 ? (Math.min(...lefts) + Math.max(...rights)) / 2 : 0;
		const innerCenterY =
			innerNodes.length > 0 ? (Math.min(...tops) + Math.max(...bottoms)) / 2 : 0;
		const dx = groupCenterX - innerCenterX;
		const dy = groupCenterY - innerCenterY;

		const clonedNodes: GraphDocumentNode[] = innerNodes.map((n) => ({
			id: idMap.get(n.id) ?? n.id,
			type: n.type ?? "",
			data: JSON.parse(JSON.stringify(n.data)) as Record<string, unknown>,
			position: { x: n.position.x + dx, y: n.position.y + dy },
			...(n.group
				? { group: { definitionRef: n.group.definitionRef, locked: n.group.locked } }
				: {}),
		}));

		const remap = (id: string): string => idMap.get(id) ?? id;
		const isBoundary = (id: string): boolean => id === inputNode?.id || id === outputNode?.id;

		// Internal edges (both endpoints are inner, non-boundary nodes) - clone directly.
		const clonedInnerEdges: GraphDocumentEdge[] = def.edges
			.filter((e) => !isBoundary(e.source) && !isBoundary(e.target))
			.map((e) => ({
				id: crypto.randomUUID(),
				source: remap(e.source),
				target: remap(e.target),
				sourceHandle: e.sourceHandle,
				targetHandle: e.targetHandle,
			}));

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

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local set, not reactive state
		const removedEdgeIds = new Set([
			...incomingOuter.map((e) => e.id),
			...outgoingOuter.map((e) => e.id),
		]);

		this.activeDocument.nodes = [
			...this.activeDocument.nodes.filter((n) => n.id !== groupNode.id),
			...(clonedNodes as GroupedNode[]),
		];
		this.rebuildDocumentIndex(this.activeDocument);
		this.activeDocument.edges = [
			...this.activeDocument.edges.filter((e) => !removedEdgeIds.has(e.id)),
			...clonedInnerEdges,
			...boundaryEdges,
		];
		this.rebuildDocumentIndex(this.activeDocument);

		// Rebuild types since the graph structure changed significantly
		this.rebuildTypeCache();

		return clonedNodes.map((n) => n.id);
	}

	/**
	 * Deep-clone a locked group's definition so the user gets their own editable copy.
	 * Every node and edge ID inside the clone is regenerated to prevent collisions.
	 * Returns the new definitionRef pointing to the cloned definition.
	 */
	deepClone(lockedNodeGroupId: string): string | undefined {
		// Search the whole project: the node may live in the active document,
		// an ancestor document (e.g. a breadcrumb segment), or the currently-viewed group.
		const documents = this.project.definitions.values();
		let node: GroupedNode | undefined;
		for (const doc of documents) {
			const found = doc.nodesById.get(lockedNodeGroupId);
			if (found) {
				node = found;
				break;
			}
		}
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

		// Build oldId → newId map for every node
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const idMap = new Map<string, string>();
		for (const n of sourceDef.nodes) {
			idMap.set(n.id, crypto.randomUUID());
		}

		const clonedNodes: GraphDocumentNode[] = sourceDef.nodes.map((n) => ({
			id: idMap.get(n.id) ?? n.id,
			type: n.type ?? "",
			data: JSON.parse(JSON.stringify(n.data)) as Record<string, unknown>,
			position: { ...n.position },
			...(n.group
				? { group: { definitionRef: n.group.definitionRef, locked: n.group.locked } }
				: {}),
		}));

		const clonedEdges: GraphDocumentEdge[] = sourceDef.edges.map((e) => ({
			id: crypto.randomUUID(),
			source: idMap.get(e.source) ?? e.source,
			target: idMap.get(e.target) ?? e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle,
		}));

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		this.project.definitions = new Map(this.project.definitions).set(
			newDefRef,
			hydrateDocument({
				nodes: clonedNodes,
				edges: clonedEdges,
				label: this.uniqueCopyLabel(sourceDef.label),
			}),
		);

		// Point the group node at the new (unlocked) clone
		node.group = { definitionRef: newDefRef, locked: false };

		return newDefRef;
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
		this.rebuildDocumentIndex(this.activeDocument);

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

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		this.project.definitions = new Map(this.project.definitions).set(
			definitionRef,
			hydrateDocument(definition),
		);

		const groupNodeId = crypto.randomUUID();
		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position,
			group: { definitionRef, locked: false },
		};

		this.activeDocument.nodes = [...this.activeDocument.nodes, groupNode];
		this.rebuildDocumentIndex(this.activeDocument);

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
		let node: GroupedNode | undefined;
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
		if (this.isStandardLibrary(definitionRef)) return;
		if (!this.project.definitions.has(definitionRef)) return;

		const documents = this.project.definitions.values();
		let stillReferenced = false;
		for (const doc of documents) {
			if (
				doc.nodes.some(
					(n) => n.type === "node-group" && n.group?.definitionRef === definitionRef,
				)
			) {
				stillReferenced = true;
				break;
			}
		}
		if (stillReferenced) return;

		// Reassign via new Map so the $state proxy tracks the removal.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		const remaining = new Map(this.project.definitions);
		remaining.delete(definitionRef);
		this.project.definitions = remaining;

		// If we're currently viewing this (now-deleted) definition, bail out to root.
		const inPath = this.path.some((nodeId) => {
			const node = this.root.nodesById.get(nodeId);
			return node?.group?.definitionRef === definitionRef;
		});
		if (inPath) this.path = [];
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
		// Live = standard library + anything reachable from a live node instance.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local set, not reactive state
		const live = new Set<string>();
		for (const entry of this.library) live.add(entry.id);

		// The root document is always live; seed with refs it references directly.
		const queue: string[] = [];
		for (const node of this.root.nodes) {
			if (node.type === "node-group" && node.group) {
				if (!live.has(node.group.definitionRef)) {
					live.add(node.group.definitionRef);
					queue.push(node.group.definitionRef);
				}
			}
		}

		// Flood-fill: every ref reachable through nested group nodes of a live def.
		while (queue.length > 0) {
			const ref = queue.pop();
			if (ref === undefined) break;
			const def = this.project.definitions.get(ref);
			if (!def) continue;
			for (const node of def.nodes) {
				if (node.type === "node-group" && node.group) {
					const child = node.group.definitionRef;
					if (!live.has(child)) {
						live.add(child);
						queue.push(child);
					}
				}
			}
		}

		const prunable: string[] = [];
		for (const key of this.project.definitions.keys()) {
			if (!live.has(key)) prunable.push(key);
		}
		return prunable;
	}

	/** A preview of groups that `pruneUnusedDefinitions` would delete. */
	getPrunableGroups(): { ref: string; label: string; nodeCount: number }[] {
		const BOUNDARY = ["group-input", "group-output"];
		return this.getPrunableRefs().map((ref) => {
			const def = this.project.definitions.get(ref);
			const nodeCount = def
				? def.nodes.filter((n) => !BOUNDARY.includes(n.type ?? "")).length
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

		// Reassign via new Map so the $state proxy tracks the removal.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local set, not reactive state
		const removedLookup = new Set(removed);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		const remaining = new Map(
			[...this.project.definitions.entries()].filter(([key]) => !removedLookup.has(key)),
		);
		this.project.definitions = remaining;

		// If we're currently viewing a now-deleted definition, bail out to root.
		const inPath = this.path.some((nodeId) => {
			const node = this.root.nodesById.get(nodeId);
			return node?.group && removed.includes(node.group.definitionRef);
		});
		if (inPath) this.path = [];

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
			for (const h of (node.data.handles ?? []) as HandleDef[]) outputs[h.id] = h.label;
		} else if (node.type === "group-output") {
			for (const h of (node.data.handles ?? []) as HandleDef[]) inputs[h.id] = h.label;
		} else if (node.type === "node-group" && node.group) {
			const def = this.project.definitions.get(node.group.definitionRef);
			if (def) {
				const inputNode = def.nodes.find((n) => n.type === "group-input");
				const outputNode = def.nodes.find((n) => n.type === "group-output");
				for (const h of (inputNode?.data.handles ?? []) as HandleDef[])
					inputs[h.id] = h.label;
				for (const h of (outputNode?.data.handles ?? []) as HandleDef[])
					outputs[h.id] = h.label;
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
	 * Set a node-wide type override for an entire type family. When set,
	 * all inputs in that family ignore type inference and use the specified type.
	 */
	setNodeTypeOverride(nodeId: string, familyKey: string, type: WgslType) {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node) return;

		const overrides =
			(node.data.__nodeTypeOverrides as Record<string, WgslType> | undefined) ?? {};
		node.data.__nodeTypeOverrides = { ...overrides, [familyKey]: type };
		this.invalidateTypes([nodeId]);
	}

	/**
	 * Clear a node-wide type override for a family, reverting to dynamic inference.
	 */
	clearNodeTypeOverride(nodeId: string, familyKey: string) {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node) return;

		const overrides = node.data.__nodeTypeOverrides as Record<string, WgslType> | undefined;
		if (overrides) {
			const rest = { ...overrides };
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete rest[familyKey];
			node.data.__nodeTypeOverrides = rest;
		}
		this.invalidateTypes([nodeId]);
	}

	/**
	 * Check if a type family on a node is in forced (manual override) mode.
	 */
	isNodeForced(nodeId: string, familyKey: string): boolean {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (!node) return false;
		const overrides = node.data.__nodeTypeOverrides as Record<string, WgslType> | undefined;
		return overrides?.[familyKey] !== undefined;
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
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local Set, never stored in reactive state
			const activeOutIds = new Set(cached.resolvedOutputs.map((o) => o.id));
			for (const doc of documents) {
				doc.edges = doc.edges.filter(
					(e) => !(e.source === nodeId && !activeOutIds.has(e.sourceHandle)),
				);
				this.rebuildDocumentIndex(doc);
			}

			// Clean dangling target handles (inputs) — read from cached resolved inputs
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local Set, never stored in reactive state
			const activeInIds = new Set(cached.resolvedInputs.map((i) => i.id));
			for (const doc of documents) {
				doc.edges = doc.edges.filter(
					(e) => !(e.target === nodeId && !activeInIds.has(e.targetHandle)),
				);
				this.rebuildDocumentIndex(doc);
			}
		}

		// Trigger reactivity by creating a new Map reference
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		this.typeCache = new Map(this.typeCache);
	}

	/**
	 * Rebuild the entire type cache from scratch. Called on project load
	 * and when the document structure changes fundamentally.
	 */
	rebuildTypeCache(): void {
		// Clear the TypeResolver's memoisation cache so every node is recomputed
		this.typeResolver.clearCache();

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned for reactivity, not mutated
		this.typeCache = new Map(this.typeCache);
	}

	/** Rebuild the indexed Maps (nodesById, edgesBySource, edgesByTarget) for a document. */
	private rebuildDocumentIndex(doc: HydratedGraphDocument): void {
		const idx = buildDocumentIndex(doc.nodes, doc.edges);
		doc.nodesById = idx.nodesById;
		doc.edgesBySource = idx.edgesBySource;
		doc.edgesByTarget = idx.edgesByTarget;
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
		this.rebuildDocumentIndex(def);

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
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local Set, never stored in reactive state
			const ids = new Set(instanceIds);
			doc.edges = doc.edges.filter(
				(e) =>
					!(
						(ids.has(e.source) && e.sourceHandle === handleId) ||
						(ids.has(e.target) && e.targetHandle === handleId)
					),
			);
			this.rebuildDocumentIndex(doc);
		}
	}
}

// ── Grouping helpers (extracted from groupSelection) ──────────────────────────

function computeSelectionBounds(selectedNodes: GroupedNode[]) {
	const lefts = selectedNodes.map((n) => n.position.x);
	const tops = selectedNodes.map((n) => n.position.y);
	const rights = selectedNodes.map((n) => n.position.x + (n.width ?? 0));
	const bottoms = selectedNodes.map((n) => n.position.y + (n.height ?? 0));

	const minX = Math.min(...lefts);
	const maxX = Math.max(...rights);
	const minY = Math.min(...tops);
	const maxY = Math.max(...bottoms);

	return {
		centerX: (minX + maxX) / 2,
		centerY: (minY + maxY) / 2,
		minX,
		maxX,
	};
}

type ClassifiedEdges = {
	internal: GraphDocumentEdge[];
	incoming: GraphDocumentEdge[];
	outgoing: GraphDocumentEdge[];
};

function classifyEdges(selectedNodeIds: Set<string>, edges: GraphDocumentEdge[]): ClassifiedEdges {
	const internal = edges.filter(
		(edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
	);
	const incoming = edges.filter(
		(edge) => !selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
	);
	const outgoing = edges.filter(
		(edge) => selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
	);

	return { internal, incoming, outgoing };
}

function deduplicateBySource(edgesToGroup: GraphDocumentEdge[]): GraphDocumentEdge[][] {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local/temporary Map, never stored in reactive state
	const groups = new Map<string, GraphDocumentEdge[]>();

	for (const edge of edgesToGroup) {
		const key = `${edge.source}::${edge.sourceHandle}`;

		const existing = groups.get(key);
		if (existing) {
			existing.push(edge);
		} else {
			groups.set(key, [edge]);
		}
	}

	return [...groups.values()];
}

type BoundaryBuildResult = {
	node: GraphDocumentNode;
	handleFor: Map<GraphDocumentEdge[], HandleDef>;
};

function buildBoundaryNode(
	direction: "input" | "output",
	deduped: GraphDocumentEdge[][],
	typeResolver: TypeResolver,
	resolveNode: (id: string) => GroupedNode | undefined,
	position: { x: number; y: number },
): BoundaryBuildResult {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const handleFor = new Map<GraphDocumentEdge[], HandleDef>();
	const handles: HandleDef[] = [];
	const prefix = direction === "input" ? "Input" : "Output";
	const nodeType = direction === "input" ? "group-input" : "group-output";

	for (const [i, group] of deduped.entries()) {
		const representative = group[0];
		if (!representative) {
			console.warn("[graph] empty edge group - skipping");
			continue;
		}
		const handle: HandleDef = {
			id: crypto.randomUUID(),
			label: `${prefix} ${String(i + 1)}`,
			type: typeResolver.inferHandleType(representative, resolveNode),
		};
		handles.push(handle);
		handleFor.set(group, handle);
	}

	return {
		node: {
			id: crypto.randomUUID(),
			type: nodeType,
			data: { handles },
			position,
		},
		handleFor,
	};
}

function rewireIncomingGroup(
	group: GraphDocumentEdge[],
	handle: HandleDef,
	groupInputNodeId: string,
	groupNodeId: string,
): { outer: GraphDocumentEdge; inner: GraphDocumentEdge[] } {
	const representative = group[0];
	if (!representative) throw new Error("empty group");

	const outer: GraphDocumentEdge = {
		id: crypto.randomUUID(),
		source: representative.source,
		sourceHandle: representative.sourceHandle,
		target: groupNodeId,
		targetHandle: handle.id,
	};

	const inner: GraphDocumentEdge[] = group.map((edge) => ({
		id: crypto.randomUUID(),
		source: groupInputNodeId,
		sourceHandle: handle.id,
		target: edge.target,
		targetHandle: edge.targetHandle,
	}));

	return { outer, inner };
}

function rewireOutgoingGroup(
	group: GraphDocumentEdge[],
	handle: HandleDef,
	groupOutputNodeId: string,
	groupNodeId: string,
): { outer: GraphDocumentEdge[]; inner: GraphDocumentEdge } {
	const representative = group[0];
	if (!representative) throw new Error("empty group");

	const inner: GraphDocumentEdge = {
		id: crypto.randomUUID(),
		source: representative.source,
		sourceHandle: representative.sourceHandle,
		target: groupOutputNodeId,
		targetHandle: handle.id,
	};

	const outer: GraphDocumentEdge[] = group.map((edge) => ({
		id: crypto.randomUUID(),
		source: groupNodeId,
		sourceHandle: handle.id,
		target: edge.target,
		targetHandle: edge.targetHandle,
	}));

	return { outer, inner };
}

// ── Context helpers ──────────────────────────────────────────────────────────

const KEY = Symbol("graph-manager");

export function setGraphManager(m: GraphManager) {
	setContext(KEY, m);
}

export function getGraphManager(): GraphManager {
	return getContext<GraphManager>(KEY);
}
