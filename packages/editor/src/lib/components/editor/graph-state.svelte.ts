import type { Node, Edge } from "@xyflow/svelte";
import { getContext, setContext } from "svelte";

import { buildGroupDescriptor } from "./nodes/group.node";
import { buildGroupInputDescriptor } from "./nodes/groupInput.node";
import { buildGroupOutputDescriptor } from "./nodes/groupOutput.node";
import { nodeRegistry } from "./registry";
import defaultScene from "./sizing_circle.json";
import standardLibraryIndex from "./standard-library.json";
import { type GroupedNode, type HandleDef, type NodeDescriptor, type WgslType } from "./types";

// ── Serialisable document types ──────────────────────────────────────────────

/** A single subgraph: what used to be the whole document is now one level of it. */
export type GraphDocument = {
	nodes: GraphDocumentNode[];
	edges: GraphDocumentEdge[];
};

// ── Standard library per-file imports ────────────────────────────────────────

const libraryModules = import.meta.glob<{
	default: {
		id: string;
		name: string;
		category: string;
		dependencies: string[];
		definition: GraphDocument;
	};
}>("./standard-library/*.json", { eager: true });

const libraryDefinitions: Record<string, GraphDocument> = {};
for (const [, mod] of Object.entries(libraryModules)) {
	const entry = mod.default;
	libraryDefinitions[entry.id] = entry.definition;
}

export type GraphDocumentNode = {
	id: string;
	type: string;
	data: Record<string, unknown>;
	position: { x: number; y: number };
	/**
	 * Present only on group-type nodes.
	 */
	group?: {
		/**
		 * The subgraph the group is pointing to
		 */
		definitionRef: string;
		/**
		 * Whether the subgraph is editable or not
		 */
		locked: boolean;
	};
};

export type GraphDocumentEdge = {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
};

/** The whole project. Exactly one per file/save. */
export type GraphProject = {
	definitions: Record<string, GraphDocument>;
	root: GraphDocument;
};

export type HydratedGraphDocument = {
	nodes: GroupedNode[];
	edges: Edge[];
};

export type HydratedGraphProject = {
	definitions: Record<string, HydratedGraphDocument>;
	root: HydratedGraphDocument;
};

export function isGraphDocument(obj: unknown): obj is GraphDocument {
	return typeof obj === "object" && obj !== null && "nodes" in obj && "edges" in obj;
}

export function isGraphProject(obj: unknown): obj is GraphProject {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"root" in obj &&
		"definitions" in obj &&
		isGraphDocument(obj.root)
	);
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function resolveDescriptor(
	node: GroupedNode | Node,
	definitions: Record<string, HydratedGraphDocument>,
): NodeDescriptor {
	if (node.type === "group-input") {
		return buildGroupInputDescriptor((node.data.handles ?? []) as HandleDef[]);
	}
	if (node.type === "group-output") {
		return buildGroupOutputDescriptor((node.data.handles ?? []) as HandleDef[]);
	}
	if (node.type === "node-group") {
		return buildGroupDescriptor(node, definitions);
	}
	// TODO: properly handle undefined here
	return nodeRegistry[node.type];
}

export function normaliseDocument(doc: GraphDocument): GraphDocument {
	const nodes: GraphDocumentNode[] = [];
	for (const node of doc.nodes) {
		if (node.group) {
			nodes.push({ ...node, data: { ...node.data } });
			continue;
		}

		const desc = resolveDescriptor(node, {});
		// TODO: this check should happen higher up in the chain
		if (desc === undefined) {
			console.warn(`[graph] unknown node type "${node.type}" — dropping`);
			continue;
		}
		nodes.push({ ...node, data: { ...desc.defaultData, ...node.data } });
	}
	return { nodes, edges: doc.edges };
}

// Unused for now, since normaliseDocument() is in turn recursively called in hydrateProject()
/* function normaliseProject(project: GraphProject): GraphProject {
	const root = normaliseDocument(project.root);
	const definitions = Object.fromEntries(
		Object.entries(project.definitions).map(([key, doc]) => [key, normaliseDocument(doc)]),
	);
	return { root, definitions };
} */

function hydrateNode(node: GraphDocumentNode): GroupedNode {
	const base = {
		id: node.id,
		type: node.type,
		data: node.data,
		position: node.position,
	};

	if (node.group) {
		return {
			...base,
			group: node.group, // just a string pointer, nothing to hydrate
		};
	}

	return base; // not a group node at all — most nodes hit this line
}

function hydrateDocument(document: GraphDocument): HydratedGraphDocument {
	const normalised = normaliseDocument(document);

	const nodes: GroupedNode[] = normalised.nodes.map(hydrateNode);

	const edges: Edge[] = normalised.edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle,
	}));

	return { nodes, edges };
}

function hydrateProject(project: GraphProject): HydratedGraphProject {
	const root = hydrateDocument(project.root);
	const definitions = Object.fromEntries(
		Object.entries(project.definitions).map(([key, doc]) => [key, hydrateDocument(doc)]),
	);
	return { root, definitions };
}

/**
 * Serialise a single subgraph's live SvelteFlow Node[]/Edge[] back to a GraphDocument.
 * NOTE: like normaliseDocument, this is per-subgraph only. A `serialiseProject` wrapping
 * this for root + definitions + recursing into owned content is still TODO.
 */
export function serialiseDocument(nodes: Node[], edges: Edge[]): GraphDocument {
	return {
		nodes: nodes.map(({ id, type, data, position }) => ({
			id,
			type: type ?? "",
			data,
			position,
			// TODO: a live SvelteFlow Node doesn't carry `group` today — that lives only in
			// your GraphProject tree, not in the flat Node/Edge shape SvelteFlow binds to.
			// serialiseDocument as called from GraphManager will need the *source* GraphDocument
			// (to pull `group` back out per node) alongside the live nodes/edges, since SvelteFlow's
			// bound arrays only ever reflect ONE subgraph's worth of nodes at a time anyway.
		})),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined,
		})),
	};
}

// ── Reactive state manager ───────────────────────────────────────────────────

export type StandardLibraryEntry = {
	id: string;
	name: string;
	category: string;
	dependencies: string[];
	definition: GraphDocument;
};

export class GraphManager {
	/** The entire project tree. */
	project = $state<HydratedGraphProject>({ definitions: {}, root: { nodes: [], edges: [] } });

	/**
	 * Breadcrumb path of group-node ids from root down to the currently-viewed subgraph.
	 * [] means "viewing root". ["node-7"] means "viewing node-7's content".
	 * ["node-7", "node-12"] means nested two levels deep.
	 */
	path = $state<string[]>([]);

	/** Currently selected node IDs in SvelteFlow. */
	selectedNodeIds = $state<string[]>([]);

	/** Read-only standard library entries for browsing. */
	library: StandardLibraryEntry[] = standardLibraryIndex.library.map((meta) => ({
		...meta,
		definition: libraryDefinitions[meta.id] ?? { nodes: [], edges: [] },
	}));

	constructor(defaults?: GraphProject) {
		const project: GraphProject = defaults ?? defaultScene;
		this.project = hydrateProject(project);

		// Register standard library definitions so they can be referenced by group nodes
		for (const entry of this.library) {
			const def = normaliseDocument(entry.definition);
			this.project.definitions[entry.id] = hydrateDocument(def);
		}
	}

	get activeDocument(): HydratedGraphDocument {
		let current: HydratedGraphDocument = this.project.root;
		for (const nodeId of this.path) {
			const node = current.nodes.find((n) => n.id === nodeId);
			if (!node?.group) {
				console.warn(`[graph] invalid path segment "${nodeId}" — resetting to root`);
				this.path = [];
				return this.project.root;
			}
			const definition = this.project.definitions[node.group.definitionRef];
			if (!definition) {
				console.warn(
					`[graph] missing definition "${node.group.definitionRef}" — resetting to root`,
				);
				this.path = [];
				return this.project.root;
			}
			current = definition;
		}
		return current;
	}

	resolveDescriptor(node: GroupedNode | Node): NodeDescriptor {
		return resolveDescriptor(node, this.project.definitions);
	}

	get nodes(): GroupedNode[] {
		return this.activeDocument.nodes;
	}
	set nodes(value: GroupedNode[]) {
		this.activeDocument.nodes = value;
	}
	get edges(): Edge[] {
		return this.activeDocument.edges;
	}
	set edges(value: Edge[]) {
		this.activeDocument.edges = value;
	}

	/** Whether the currently-viewed subgraph (or any of its ancestors) is locked. */
	get isLocked(): boolean {
		let current: HydratedGraphDocument = this.project.root;
		for (const nodeId of this.path) {
			const node = current.nodes.find((n) => n.id === nodeId);
			if (!node?.group) return false;
			if (node.group.locked) return true;
			const definition = this.project.definitions[node.group.definitionRef];
			if (!definition) return false;
			current = definition;
		}
		return false;
	}

	/** The definitionRef of the first selected group node, if any. */
	get selectedGroupRef(): string | undefined {
		for (const id of this.selectedNodeIds) {
			const node = this.activeDocument.nodes.find((n) => n.id === id);
			if (node?.type === "node-group" && node.group) {
				return node.group.definitionRef;
			}
		}
		return undefined;
	}

	/** Labels for each segment of the breadcrumb path, suitable for rendering. */
	get pathLabels(): { id: string; label: string }[] {
		const labels: { id: string; label: string }[] = [];
		let current: HydratedGraphDocument = this.project.root;
		for (const nodeId of this.path) {
			const node = current.nodes.find((n) => n.id === nodeId);
			if (!node?.group) break;
			const definition = this.project.definitions[node.group.definitionRef];
			if (!definition) break;
			const nodeType = node.type ?? "unknown";
			const desc = nodeRegistry[nodeType];
			labels.push({ id: nodeId, label: desc?.label ?? nodeType });
			current = definition;
		}
		return labels;
	}

	/** Push a group node's id onto the breadcrumb path — "enter" it. */
	enterGroup(groupNodeId: string) {
		const node = this.activeDocument.nodes.find((n) => n.id === groupNodeId);
		if (!node?.group) {
			console.warn(`[graph] cannot enter "${groupNodeId}" — not a group node`);
			return;
		}
		this.path = [...this.path, groupNodeId];
	}

	/** Pop one level off the breadcrumb path — "exit" the current group. */
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

	loadProject(project: GraphProject) {
		this.project = hydrateProject(project);
		this.path = [];

		// Re-register standard library definitions after loading
		for (const entry of this.library) {
			const def = normaliseDocument(entry.definition);
			this.project.definitions[entry.id] = hydrateDocument(def);
		}
	}

	getProjectJson(): string {
		const root = serialiseDocument(this.project.root.nodes, this.project.root.edges);
		const definitions = Object.fromEntries(
			Object.entries(this.project.definitions).map(([key, definition]) => [
				key,
				serialiseDocument(definition.nodes, definition.edges),
			]),
		);
		const project = { root, definitions };
		return JSON.stringify(project, null, "\t");
	}

	loadFromString(text: string) {
		try {
			const project = JSON.parse(text) as GraphProject;
			this.loadProject(project);
		} catch (err) {
			console.error("[graph] failed to parse JSON", err);
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

	async upload(file: File) {
		try {
			const text = await file.text();
			const project = JSON.parse(text) as GraphProject;
			this.loadProject(project);
		} catch (err) {
			console.error("[graph] failed to parse uploaded JSON", err);
		}
	}

	// ── Export / Import ───────────────────────────────────────────────────────

	/** Check if a definitionRef belongs to the standard library. */
	private isStandardLibrary(definitionRef: string): boolean {
		return this.library.some((e) => e.id === definitionRef);
	}

	/**
	 * Collect all nested group definitionRefs referenced by a definition.
	 * Does NOT include standard library refs (they're always available).
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pure algorithm helper, not reactive state
	private collectNestedRefs(definitionRef: string, visited = new Set<string>()): string[] {
		if (visited.has(definitionRef) || this.isStandardLibrary(definitionRef)) return [];
		visited.add(definitionRef);

		const def = this.project.definitions[definitionRef];
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
				name: string;
				category: string;
				dependencies: string[];
				definition: GraphDocument;
		  }
		| undefined {
		const def = this.project.definitions[definitionRef];
		if (!def) return undefined;

		const deps = this.collectNestedRefs(definitionRef);
		const entry = this.library.find((e) => e.id === definitionRef);

		return {
			id: definitionRef,
			name: entry?.name ?? "Group",
			category: entry?.category ?? "group",
			dependencies: deps,
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
					sourceHandle: e.sourceHandle ?? undefined,
					targetHandle: e.targetHandle ?? undefined,
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
			const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
			name?: string;
			category?: string;
			dependencies?: string[];
			definition?: GraphDocument;
		}[],
	) {
		// Phase 1: Load all definitions
		for (const file of jsonFiles) {
			if (!file.id || !file.definition) {
				console.warn("[graph] skipping malformed import entry", file);
				continue;
			}
			const normalised = normaliseDocument(file.definition);
			this.project.definitions[file.id] = hydrateDocument(normalised);
		}

		// Phase 2: Check dependencies
		const missing: string[] = [];
		for (const file of jsonFiles) {
			if (!file.id || !file.dependencies) continue;
			for (const dep of file.dependencies) {
				if (!this.project.definitions[dep] && !this.isStandardLibrary(dep)) {
					missing.push(`${file.id} depends on ${dep}`);
				}
			}
		}

		if (missing.length > 0) {
			console.warn("[graph] imported groups have missing dependencies:", missing);
		}

		return { imported: jsonFiles.length, missing };
	}

	// TODO: groupSelection(nodeIds: string[]): void
	// The Ctrl+G operation. Not stubbed here since you said you want to design the
	// edge-rewiring logic yourself — but it belongs on this class, since it needs to
	// mutate `project` (remove nodes from activeDocument, create a new group node in
	// their place, move them into that new node's `group.content`, and rewrite any edge
	// that crossed the selection boundary to instead terminate on a new Group Input/Output
	// node inside the new content).
	//
	groupSelection(selectedNodeIds: Set<string>): void {
		console.log("hit! Selected nodes: " + [...selectedNodeIds].join(", "));

		const selectedNodes = this.activeDocument.nodes.filter((node) =>
			selectedNodeIds.has(node.id),
		);
		const bounds = computeSelectionBounds(selectedNodes);

		const { internal, incoming, outgoing } = classifyEdges(
			selectedNodeIds,
			this.activeDocument.edges as GraphDocumentEdge[], // We could pick only the GraphDocumentEdge properites of each Edge, but passing the raw object is more memory-efficient
		);
		const dedupedIncoming = deduplicateBySource(incoming);
		const dedupedOutgoing = deduplicateBySource(outgoing);

		const OFFSET = 300;

		const groupInputNode = buildGroupInputNode(
			dedupedIncoming,
			this.activeDocument.nodes,
			(node) => this.resolveDescriptor(node),
			{ x: bounds.minX - OFFSET, y: bounds.centerY },
		);
		const groupOutputNode = buildGroupOutputNode(
			dedupedOutgoing,
			this.activeDocument.nodes,
			(node) => this.resolveDescriptor(node),
			{ x: bounds.maxX + OFFSET, y: bounds.centerY },
		);

		// Detect globals from selected nodes — store as metadata only, no handles
		// (globals are implicit inputs, not user-visible connections)
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seenGlobalRefs = new Set<string>();
		const allGlobals: { name: string; type: WgslType; wgslRef: string }[] = [];
		for (const node of selectedNodes) {
			const descriptor = this.resolveDescriptor(node);
			if (!descriptor.globals) continue;
			for (const g of descriptor.globals) {
				if (!seenGlobalRefs.has(g.wgslRef)) {
					seenGlobalRefs.add(g.wgslRef);
					allGlobals.push(g);
				}
			}
		}
		if (allGlobals.length > 0) {
			(groupInputNode.node.data as Record<string, unknown>).globals = allGlobals;
		}

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
			nodes: [...selectedNodes, groupInputNode.node, groupOutputNode.node],
			edges: [...internal, ...allInnerEdges],
		};

		this.project.definitions[definitionRef] = definition;

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
			...this.activeDocument.nodes.filter((n) => !selectedNodeIds.has(n.id)),
			groupNode,
		];

		this.activeDocument.edges = [
			...this.activeDocument.edges.filter((e) => !touchedEdgeIds.has(e.id)),
			...allOuterEdges,
		];

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

		/** Only returns those three sets of edges, discards the rest */
		function classifyEdges(
			selectedNodeIds: Set<string>,
			edges: GraphDocumentEdge[],
		): ClassifiedEdges {
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
				const key = `${edge.source}::${edge.sourceHandle ?? ""}`;

				const existing = groups.get(key);
				if (existing) {
					existing.push(edge);
				} else {
					groups.set(key, [edge]);
				}
			}

			return [...groups.values()];
		}

		function inferHandleType(
			edge: GraphDocumentEdge,
			nodes: GroupedNode[],
			resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
		): WgslType {
			const sourceNode = nodes.find((n) => n.id === edge.source);
			if (!sourceNode) return "f32"; // shouldn't happen, but fail soft

			const descriptor = resolveDescriptor(sourceNode);
			const outputDef = descriptor.outputs.find(
				(o) => o.name === edge.sourceHandle || descriptor.outputs.length === 1,
			);

			return outputDef?.type ?? "f32";
		}

		type BoundaryBuildResult = {
			node: GraphDocumentNode;
			handleFor: Map<GraphDocumentEdge[], HandleDef>;
		};

		function buildGroupInputNode(
			dedupedIncoming: GraphDocumentEdge[][],
			activeDocumentNodes: GroupedNode[],
			resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
			position: { x: number; y: number },
		): BoundaryBuildResult {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const handleFor = new Map<GraphDocumentEdge[], HandleDef>();
			const handles: HandleDef[] = [];

			for (const [i, group] of dedupedIncoming.entries()) {
				const representative = group[0];
				if (!representative) {
					console.warn("[graph] empty edge group — skipping");
					continue;
				}
				const handle: HandleDef = {
					id: crypto.randomUUID(),
					label: `Input ${String(i + 1)}`,
					type: inferHandleType(representative, activeDocumentNodes, resolveDescriptor),
				};
				handles.push(handle);
				handleFor.set(group, handle);
			}

			return {
				node: {
					id: crypto.randomUUID(),
					type: "group-input",
					data: { handles },
					position,
				},
				handleFor,
			};
		}

		function buildGroupOutputNode(
			dedupedOutgoing: GraphDocumentEdge[][],
			activeDocumentNodes: GroupedNode[],
			resolveDescriptor: (node: GroupedNode) => NodeDescriptor,
			position: { x: number; y: number },
		): BoundaryBuildResult {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const handleFor = new Map<GraphDocumentEdge[], HandleDef>();
			const handles: HandleDef[] = [];

			for (const [i, group] of dedupedOutgoing.entries()) {
				const representative = group[0];
				if (!representative) {
					console.warn("[graph] empty edge group — skipping");
					continue;
				}
				const handle: HandleDef = {
					id: crypto.randomUUID(),
					label: `Output ${String(i + 1)}`,
					type: inferHandleType(representative, activeDocumentNodes, resolveDescriptor),
				};
				handles.push(handle);
				handleFor.set(group, handle);
			}

			return {
				node: {
					id: crypto.randomUUID(),
					type: "group-output",
					data: { handles },
					position,
				},
				handleFor,
			};
		}

		type RewireIncomingResult = {
			outer: GraphDocumentEdge; // one edge, replacing all originals from this source
			inner: GraphDocumentEdge[]; // one edge per original target, now sourced from group-input
		};

		function rewireIncomingGroup(
			group: GraphDocumentEdge[],
			handle: HandleDef,
			groupInputNodeId: string,
			groupNodeId: string,
		): RewireIncomingResult {
			const representative = group[0];
			if (!representative) throw new Error("empty group"); // shouldn't happen, per earlier guard

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

		type RewireOutgoingResult = {
			outer: GraphDocumentEdge[];
			inner: GraphDocumentEdge;
		};

		function rewireOutgoingGroup(
			group: GraphDocumentEdge[],
			handle: HandleDef,
			groupOutputNodeId: string,
			groupNodeId: string,
		): RewireOutgoingResult {
			const representative = group[0];
			if (!representative) throw new Error("empty group"); // shouldn't happen, per earlier guard

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
	}

	/**
	 * Deep-clone a locked group's definition so the user gets their own editable copy.
	 * Every node and edge ID inside the clone is regenerated to prevent collisions.
	 * Returns the new definitionRef pointing to the cloned definition.
	 */
	deepClone(lockedNodeGroupId: string): string | undefined {
		const node = this.activeDocument.nodes.find((n) => n.id === lockedNodeGroupId);
		if (!node?.group) {
			console.warn(`[graph] deepClone: "${lockedNodeGroupId}" is not a group node`);
			return undefined;
		}

		const sourceDef = this.project.definitions[node.group.definitionRef];
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
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined,
		}));

		this.project.definitions[newDefRef] = { nodes: clonedNodes, edges: clonedEdges };

		// Point the group node at the new (unlocked) clone
		node.group = { definitionRef: newDefRef, locked: false };

		return newDefRef;
	}

	/**
	 * Add a node-group to the active document from a standard-library definition.
	 * The definition is deep-cloned so the original is never mutated.
	 */
	addFromLibrary(definitionRef: string, position: { x: number; y: number }): string | undefined {
		const sourceDef = this.project.definitions[definitionRef];
		if (!sourceDef) {
			console.warn(`[graph] addFromLibrary: unknown definition "${definitionRef}"`);
			return undefined;
		}

		const newDefRef = crypto.randomUUID();

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
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined,
		}));

		this.project.definitions[newDefRef] = { nodes: clonedNodes, edges: clonedEdges };

		const groupNodeId = crypto.randomUUID();
		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position,
			group: { definitionRef: newDefRef, locked: true },
		};

		this.activeDocument.nodes = [...this.activeDocument.nodes, groupNode];

		return groupNodeId;
	}
}

// ── Context helpers ──────────────────────────────────────────────────────────

const KEY = Symbol("graph-manager");

export function setGraphManager(m: GraphManager) {
	setContext(KEY, m);
}

export function getGraphManager(): GraphManager {
	return getContext<GraphManager>(KEY);
}
