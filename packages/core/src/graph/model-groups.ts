import * as v from "valibot";

import {
	groupConstants,
	hiddenInputsOf,
	isUnder,
	ownerChain,
	ownerExists,
	shownApart,
} from "../enums";
import { commonFrame } from "../frames";
import { nodeRegistry } from "../nodes/registry";
import {
	type ColorDisplay,
	type EnumVariant,
	type GroupHandleDef,
	type InputOwner,
	type InputValue,
	type NodeData,
	type SocketType,
	type TypeBindings,
	type TypeOwner,
	type TypeVariable,
	type WgslType,
	type ZoneItem,
} from "../types";
import { wouldCreateCycle } from "../zones";
import {
	type GraphDocument,
	type GraphDocumentEdge,
	type GraphDocumentNode,
	type GraphEdge,
	type GraphNode,
	type HydratedGraphDocument,
	ROOT_ID,
} from "./document";
import {
	BOUNDARY_TYPES,
	buildBoundaryNode,
	classifyEdges,
	cloneSubgraph,
	computeSelectionBounds,
	deduplicateBySource,
	groupRefsOf,
	type GroupSide,
	interfaceOf,
	rewireIncomingGroup,
	rewireOutgoingGroup,
	sideOf,
} from "./editing";
import { indexDocument, normaliseDocument, serialiseEdge, serialiseNode } from "./hydrate";
import { withEntry } from "./model-base";
import { ZoneModel } from "./model-zones";
import { GroupFilesSchema } from "./schema";

/** Names given to new type variables, in turn. */
const VARIABLE_NAMES = ["T", "U", "V", "W", "X", "Y", "Z", "A", "B", "C", "D", "E"];

// ── Definitions and references ──────────────────────────────────────────────

/** Group editing: grouping, definitions and their handles, import / export. */
export abstract class GroupModel extends ZoneModel {
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

	/**
	 * Collect all definitionRefs that are "in scope" - i.e. the definitions
	 * the user is currently inside of, as determined by the breadcrumb path.
	 */
	protected collectInScopeRefs(): Set<string> {
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
	protected reachableUserRefs(seeds: Iterable<string>): Set<string> {
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
	protected usedLabels(): Set<string> {
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
	protected uniqueCopyLabel(sourceLabel: string | undefined): string {
		if (!sourceLabel) return "Group";
		const existing = this.usedLabels();
		const base = `${sourceLabel} - Copy`;
		if (!existing.has(base)) return base;
		let n = 2;
		while (existing.has(`${base} ${String(n)}`)) n++;
		return `${base} ${String(n)}`;
	}

	/** User group definitions nested (at any depth) inside a definition. */
	protected collectNestedRefs(definitionRef: string): string[] {
		const def = this.project.definitions.get(definitionRef);
		const nested = this.reachableUserRefs(def ? groupRefsOf(def) : []);
		nested.delete(definitionRef);
		return [...nested];
	}

	/**
	 * Build the metadata for a single group definition export.
	 * The definitionRef is used as the stable id.
	 */
	protected buildExportEntry(definitionRef: string):
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
		const entry = this.library.find((e) => e.ref === definitionRef);

		return {
			id: definitionRef,
			label: def.label ?? entry?.label ?? "Group",
			category: entry?.category ?? "group",
			dependencies: deps,
			locked: def.locked,
			definition: structuredClone({
				nodes: def.nodes.map(serialiseNode),
				edges: def.edges.map(serialiseEdge),
				...(def.typeVariables.length > 0 ? { typeVariables: def.typeVariables } : {}),
			}),
		};
	}

	// ── Import / export ─────────────────────────────────────────────────────────

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
	async importGroups(
		jsonFiles: unknown[],
	): Promise<{ imported: number; missing: string[]; rejected: string[] }> {
		const parsed = v.safeParse(GroupFilesSchema, jsonFiles);
		if (!parsed.success) {
			console.error("[graph] rejected invalid group import", v.flatten(parsed.issues));
			const idOf = (file: unknown) => {
				const id = v.safeParse(v.object({ id: v.string() }), file);
				return id.success ? id.output.id : "<unknown>";
			};
			return { imported: 0, missing: [], rejected: jsonFiles.map(idOf) };
		}

		const entries = parsed.output;
		await this.fetchArchivedVersions(entries.map((file) => file.definition));
		// Phase 1: Load all definitions
		for (const file of entries) {
			const normalised = normaliseDocument(file.definition);
			if (file.label) normalised.label = file.label;
			normalised.locked = true;
			this.setDefinitions([[file.id, this.hydrate(normalised)]]);
		}
		this.registerLibraryRefs();

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

	// ── Grouping ────────────────────────────────────────────────────────────────

	groupSelection(selectedNodeIds: Set<string>): void {
		const UNGROUPABLE_TYPES = new Set(["frag-output", "group-input", "group-output"]);

		// A frame is grouped with what it holds, and a zone as a whole:
		// selecting either boundary brings in its partner and everything
		// inside it.
		const frames = this.frameAnalysis(this.activeDocument);
		const expandedIds = new Set(selectedNodeIds);
		for (const id of selectedNodeIds) {
			for (const inside of frames.frames.get(id)?.descendants ?? []) expandedIds.add(inside);
		}
		const zones = this.activeZones;
		for (const id of selectedNodeIds) {
			const zone = zones.zones.get(zones.zoneOfBoundary.get(id) ?? "");
			if (!zone) continue;
			for (const member of [zone.inputId, zone.outputId, ...zone.members]) {
				expandedIds.add(member);
			}
		}

		const selectedNodes = this.activeDocument.nodes.filter(
			(node) => expandedIds.has(node.id) && !UNGROUPABLE_TYPES.has(node.type),
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

		const groupInputNode = buildBoundaryNode("input", dedupedIncoming, this.typeResolver, {
			x: bounds.minX - OFFSET,
			y: bounds.centerY,
		});
		const groupOutputNode = buildBoundaryNode("output", dedupedOutgoing, this.typeResolver, {
			x: bounds.maxX + OFFSET,
			y: bounds.centerY,
		});

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
				// Frames left outside don't come along.
				...selectedNodes.map((n): GraphDocumentNode => {
					const node = n as GraphDocumentNode;
					return n.frame === undefined || filteredIds.has(n.frame)
						? node
						: { ...node, frame: undefined };
				}),
				groupInputNode.node,
				groupOutputNode.node,
			],
			edges: [...internal, ...allInnerEdges],
			label: this.nextGroupLabel(),
			inputs: groupInputNode.handles,
			outputs: groupOutputNode.handles,
		};

		this.setDefinitions([[definitionRef, this.hydrate(definition)]]);

		const frame = commonFrame(frames, filteredIds);
		const groupNode: GraphDocumentNode = {
			id: groupNodeId,
			type: "node-group",
			data: {},
			position: { x: bounds.centerX, y: bounds.centerY },
			group: { definitionRef, locked: false },
			...(frame === null ? {} : { frame }),
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
	protected groupingWouldCreateCycle(selection: Set<string>): boolean {
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
	protected ungroupNode(groupNode: GraphNode): string[] {
		if (!groupNode.group) return [];
		const def = this.project.definitions.get(groupNode.group.definitionRef);
		if (!def) return [];

		const innerNodes = def.nodes.filter((n) => !BOUNDARY_TYPES.has(n.type));

		// Re-center the inner nodes on the group node.
		const inner = innerNodes.length > 0 ? computeSelectionBounds(innerNodes) : undefined;
		const offset = {
			x: groupNode.position.x + (groupNode.width ?? 0) / 2 - (inner?.centerX ?? 0),
			y: groupNode.position.y + (groupNode.height ?? 0) / 2 - (inner?.centerY ?? 0),
		};
		// Edges between inner nodes come along; boundary edges are spliced below.
		const clone = cloneSubgraph(innerNodes, def.edges, offset);
		const remap = (id: string): string => clone.idMap.get(id) ?? id;
		// What was in no frame of the group goes in the group node's.
		if (groupNode.frame !== undefined) {
			for (const node of clone.nodes) node.frame ??= groupNode.frame;
		}

		// Outer edges connected to this group node instance.
		const incomingOuter = this.activeDocument.edgesByTarget.get(groupNode.id) ?? [];
		const outgoingOuter = this.activeDocument.edgesBySource.get(groupNode.id) ?? [];

		const boundaryEdges: GraphDocumentEdge[] = [];

		// group-input handle -> inner target. Splice: outer source -> inner target.
		for (const innerEdge of def.edges) {
			if (sideOf(def.nodesById.get(innerEdge.source)) !== "input") continue;
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
			if (sideOf(def.nodesById.get(innerEdge.target)) !== "output") continue;
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
					typeVariables: structuredClone(sourceDef.typeVariables),
					inputs: structuredClone(sourceDef.inputs),
					outputs: structuredClone(sourceDef.outputs),
					defaults: structuredClone(sourceDef.defaults),
				}),
			],
		]);

		// Point the group node at the new (unlocked) clone
		const doc = this.documentOf(node.id);
		if (doc) {
			const group = { definitionRef: newDefRef, locked: false };
			this.setContent(doc, {
				nodes: doc.nodes.map((n) => (n.id === node.id ? { ...n, group } : n)),
			});
		}
		this.rebuildTypeCache();

		return newDefRef;
	}

	// ── Instances ───────────────────────────────────────────────────────────────

	/**
	 * Add a node-group to the active document from an existing definition.
	 * Standard library definitions are referenced directly (locked).
	 * User-created definitions are shared across all instances (unlocked).
	 * Returns undefined if the addition would create a circular reference.
	 */
	addFromLibrary(
		definitionRef: string,
		position: { x: number; y: number },
		data: NodeData = {},
	): string | undefined {
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
			data,
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

		const inputHandle: GroupHandleDef = {
			id: crypto.randomUUID(),
			label: "Input 1",
			type: "f32",
		};
		const outputHandle: GroupHandleDef = {
			id: crypto.randomUUID(),
			label: "Output 1",
			type: "f32",
		};

		const definition: GraphDocument = {
			nodes: [
				{
					id: inputNodeId,
					type: "group-input",
					data: {},
					position: { x: -200, y: 0 },
				},
				{
					id: outputNodeId,
					type: "group-output",
					data: {},
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
			inputs: [inputHandle],
			outputs: [outputHandle],
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
	protected nextGroupLabel(): string {
		const count = [...this.project.definitions.keys()].filter(
			(k) => !this.isStandardLibrary(k),
		).length;
		return `Group ${String(count)}`;
	}

	// ── Labels and pruning ──────────────────────────────────────────────────────

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
			const nodeCount = def ? def.nodes.filter((n) => !BOUNDARY_TYPES.has(n.type)).length : 0;
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

	/**
	 * Rename an input or output of a group. Rejected (returning false) when
	 * another of the same side has that label, unless the two are never shown
	 * together (inputs of different variants).
	 */
	setHandleLabel(
		definitionRef: string,
		side: GroupSide,
		handleId: string,
		label: string,
	): boolean {
		const def = this.project.definitions.get(definitionRef);
		const handles = interfaceOf(def, side);
		const handle = handles.find((h) => h.id === handleId);
		const trimmed = label.trim();
		if (!def || !handle || !trimmed) return false;

		// Two inputs shown on the same group node can't share a label.
		const apart = (h: GroupHandleDef) => side === "input" && shownApart(handles, handle, h);
		if (handles.some((h) => h.id !== handleId && h.label === trimmed && !apart(h))) {
			return false;
		}
		this.setInterface(
			def,
			side,
			handles.map((h) => (h.id === handleId ? { ...h, label: trimmed } : h)),
		);
		return true;
	}

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

		const side = sideOf(node);
		if (side) {
			const labels = side === "input" ? outputs : inputs;
			for (const h of interfaceOf(this.documentOf(nodeId), side)) labels[h.id] = h.label;
		} else if (node.type === "node-group" && node.group) {
			const def = this.project.definitions.get(node.group.definitionRef);
			for (const h of def?.inputs ?? []) inputs[h.id] = h.label;
			for (const h of def?.outputs ?? []) outputs[h.id] = h.label;
		}

		return { inputs, outputs };
	}

	/** The enum values a group node sets itself (see `groupConstants`), by handle id. */
	protected instanceEnumValues(node: GraphNode, bindings: TypeBindings): Map<string, number> {
		const doc = this.documentOf(node.id);
		return doc
			? groupConstants(doc, node, this.project.definitions, bindings)
			: new Map<string, number>();
	}

	/**
	 * The inputs a group node doesn't show, seen from `path`: those under a
	 * variant of one of its enums other than the one it's on, or owned by
	 * types its variables don't have there. Their links stay, unused, for
	 * when that variant or type is picked again.
	 */
	hiddenInputs(nodeId: string, path: readonly string[] = this.path): Set<string> {
		const node = this.resolveNode(nodeId);
		const def = node?.group && this.project.definitions.get(node.group.definitionRef);
		const doc = this.documentOf(nodeId);
		if (node?.type !== "node-group" || !def || !doc) return new Set();
		const bindings = this.typesOf(node, path).bindings ?? {};
		return hiddenInputsOf(def.inputs, this.instanceEnumValues(node, bindings), bindings);
	}

	// ── Boundary handles ────────────────────────────────────────────────────────

	/**
	 * Add an input or output to a group. An input can be an enum
	 * (`variants`), or belong to a variant (`owner`): it then comes after the
	 * inputs already under that enum.
	 */
	addHandle(
		definitionRef: string,
		side: GroupSide,
		type: SocketType,
		{ variants, owner }: { variants?: EnumVariant[]; owner?: InputOwner } = {},
	): GroupHandleDef | undefined {
		const def = this.project.definitions.get(definitionRef);
		if (!def || definitionRef === ROOT_ID) return undefined;
		const handles = interfaceOf(def, side);
		const isInput = side === "input";
		const prefix = variants ? "Enum" : isInput ? "Input" : "Output";
		const labels = new Set(handles.map((h) => h.label));
		let n = 1;
		while (labels.has(`${prefix} ${String(n)}`)) n++;
		// Only an output's type can be whatever reaches it.
		const inferred = typeof type === "object" && "inferred" in type;
		const handle: GroupHandleDef = {
			id: crypto.randomUUID(),
			label: `${prefix} ${String(n)}`,
			type: variants ? "u32" : isInput && inferred ? "f32" : type,
			...(isInput && variants ? { variants } : {}),
			...(isInput && ownerExists(handles, owner) && owner ? { owner } : {}),
		};
		let at = handles.length;
		if (handle.owner) {
			const enumId = handle.owner.enumId;
			const last = handles.findLastIndex(
				(h) => h.id === enumId || isUnder(handles, h, { enumId }),
			);
			at = last + 1;
		}
		this.setInterface(def, side, handles.toSpliced(at, 0, handle));
		this.rebuildTypeCache();
		return handle;
	}

	/** Add an input or output to the group a boundary node is in (see `addHandle`). */
	addBoundaryHandle(nodeId: string, type: SocketType): GroupHandleDef | undefined {
		const side = sideOf(this.resolveNode(nodeId));
		const ref = this.definitionRefOf(nodeId);
		return side && ref ? this.addHandle(ref, side, type) : undefined;
	}

	/** Replace one input or output of a group through `update`. */
	private updateHandle(
		definitionRef: string,
		side: GroupSide,
		handleId: string,
		update: (handle: GroupHandleDef) => GroupHandleDef,
	): boolean {
		const def = this.project.definitions.get(definitionRef);
		const handles = interfaceOf(def, side);
		if (!def || !handles.some((h) => h.id === handleId)) return false;
		this.setInterface(
			def,
			side,
			handles.map((h) => (h.id === handleId ? update(h) : h)),
		);
		return true;
	}

	/** Edit a vec3f / vec4f group input as a colour, or as numbers with `undefined`. */
	setHandleDisplay(definitionRef: string, handleId: string, display: ColorDisplay | undefined) {
		const changed = this.updateHandle(definitionRef, "input", handleId, (h) => {
			const rest = { ...h };
			delete rest.display;
			return display ? { ...rest, display } : rest;
		});
		if (changed) this.rebuildTypeCache();
	}

	/**
	 * Show a group input only while one of the group's type variables has
	 * one of some types, or whatever the types with `undefined`.
	 */
	setHandleTypeOwner(definitionRef: string, handleId: string, typeOwner: TypeOwner | undefined) {
		const def = this.project.definitions.get(definitionRef);
		const variable = def?.typeVariables.find((v) => v.id === typeOwner?.variable);
		if (!def || (typeOwner && !variable)) return;
		const owner = typeOwner && fitTypeOwner(typeOwner, variable?.types ?? []);
		const changed = this.updateHandle(definitionRef, "input", handleId, (h) =>
			withTypeOwner(h, owner),
		);
		if (changed) this.rebuildTypeCache();
	}

	/**
	 * Offer a variant of a group's enum input only while one of the group's
	 * type variables has one of some types, or whatever the types with
	 * `undefined`.
	 */
	setVariantTypeOwner(
		definitionRef: string,
		handleId: string,
		value: number,
		typeOwner: TypeOwner | undefined,
	) {
		const def = this.project.definitions.get(definitionRef);
		const variable = def?.typeVariables.find((v) => v.id === typeOwner?.variable);
		if (!def || (typeOwner && !variable)) return;
		const owner = typeOwner && fitTypeOwner(typeOwner, variable?.types ?? []);
		const changed = this.updateHandle(definitionRef, "input", handleId, (h) => ({
			...h,
			...(h.variants
				? {
						variants: h.variants.map((v) =>
							v.value === value ? withTypeOwner(v, owner) : v,
						),
					}
				: {}),
		}));
		if (changed) this.rebuildTypeCache();
	}

	/** Fit the type owners of inputs and variants to the group's type variables, as they now are. */
	private fitTypeOwners(def: HydratedGraphDocument) {
		const fit = <T extends { typeOwner?: TypeOwner }>(owned: T): T => {
			if (!owned.typeOwner) return owned;
			const variable = def.typeVariables.find((v) => v.id === owned.typeOwner?.variable);
			return withTypeOwner(owned, variable && fitTypeOwner(owned.typeOwner, variable.types));
		};
		const owned = def.inputs.some(
			(h) => h.typeOwner !== undefined || h.variants?.some((v) => v.typeOwner) === true,
		);
		if (owned) {
			this.setInterface(
				def,
				"input",
				def.inputs.map((h) => {
					const fitted = fit(h);
					return h.variants ? { ...fitted, variants: h.variants.map(fit) } : fitted;
				}),
			);
		}
	}

	/**
	 * Keep a group input's value within `min` and `max` while edited on group
	 * nodes (`undefined` for no bound).
	 */
	setHandleRange(
		definitionRef: string,
		handleId: string,
		{ min, max }: { min?: number | undefined; max?: number | undefined },
	) {
		const changed = this.updateHandle(definitionRef, "input", handleId, (h) => {
			const rest = { ...h };
			delete rest.min;
			delete rest.max;
			return {
				...rest,
				...(min === undefined ? {} : { min }),
				...(max === undefined ? {} : { max }),
			};
		});
		if (changed) this.rebuildTypeCache();
	}

	/**
	 * Set the value a group input has on group nodes until they're edited
	 * (`undefined` goes back to zero, or an enum's first variant).
	 */
	setHandleDefault(definitionRef: string, handleId: string, value: InputValue | undefined) {
		const def = this.project.definitions.get(definitionRef);
		if (!def) return;
		def.defaults = withEntry(def.defaults, handleId, value) ?? {};
	}

	/**
	 * Change the type of a group's input or output. Links that no longer fit
	 * (inside the definition, and on every instance of the group) are removed.
	 */
	setHandleType(definitionRef: string, side: GroupSide, handleId: string, type: SocketType) {
		const def = this.project.definitions.get(definitionRef);
		const handles = interfaceOf(def, side);
		if (!def || !handles.some((h) => h.id === handleId)) return;
		if (side === "input" && typeof type === "object" && "inferred" in type) return;

		// Only a u32 can be an enum; the inputs of a former enum's variants
		// take its place.
		const retyped = (h: GroupHandleDef): GroupHandleDef => {
			const next = { ...h, type };
			if (type !== "u32") delete next.variants;
			if (type !== "vec3f" && type !== "vec4f") delete next.display;
			return next;
		};
		const enumOwner = handles.find((h) => h.id === handleId)?.owner;
		const promoted = (h: GroupHandleDef): GroupHandleDef => {
			if (type === "u32" || h.owner?.enumId !== handleId) return h;
			const next = { ...h };
			delete next.owner;
			return enumOwner ? { ...next, owner: enumOwner } : next;
		};
		this.setInterface(
			def,
			side,
			handles.map((h) => (h.id === handleId ? retyped(h) : promoted(h))),
		);
		this.rebuildTypeCache();
		this.dropUnfitLinks(definitionRef, new Set([handleId]));
	}

	// ── Type variables ──────────────────────────────────────────────────────────

	/** Add a type variable to a group, named after the next free letter from T. */
	addTypeVariable(definitionRef: string, types: readonly WgslType[]): TypeVariable | undefined {
		const def = this.project.definitions.get(definitionRef);
		if (!def || types.length === 0) return undefined;
		const taken = new Set(def.typeVariables.map((v) => v.name));
		const name =
			VARIABLE_NAMES.find((l) => !taken.has(l)) ?? `T${String(def.typeVariables.length + 1)}`;
		const variable: TypeVariable = { id: crypto.randomUUID(), name, types: [...types] };
		def.typeVariables = [...def.typeVariables, variable];
		this.rebuildTypeCache();
		return variable;
	}

	/** Rename a type variable, or change the types it may take. */
	setTypeVariable(
		definitionRef: string,
		variableId: string,
		patch: { name?: string; types?: readonly WgslType[] },
	) {
		const def = this.project.definitions.get(definitionRef);
		if (!def || patch.types?.length === 0) return;
		def.typeVariables = def.typeVariables.map((v) =>
			v.id === variableId
				? { ...v, ...patch, ...(patch.types ? { types: [...patch.types] } : {}) }
				: v,
		);
		if (patch.types) {
			const allowed = new Set(patch.types);
			this.forEachInstance(definitionRef, (node) => {
				const forced = node.data.types?.[variableId];
				if (!forced || allowed.has(forced)) return node;
				return {
					...node,
					data: {
						...node.data,
						types: withEntry<WgslType>(node.data.types, variableId, undefined),
					},
				};
			});
		}
		if (patch.types) this.fitTypeOwners(def);
		this.rebuildTypeCache();
		if (patch.types)
			this.dropUnfitLinks(definitionRef, this.handlesOfVariable(def, variableId));
	}

	/**
	 * Remove a type variable: its sockets take the first type it could take,
	 * and group nodes forget the type they forced on it.
	 */
	removeTypeVariable(definitionRef: string, variableId: string) {
		const def = this.project.definitions.get(definitionRef);
		const variable = def?.typeVariables.find((v) => v.id === variableId);
		if (!def || !variable) return;
		const fixed = variable.types[0] ?? "f32";
		const ids = this.handlesOfVariable(def, variableId);
		for (const side of ["input", "output"] as const) {
			this.setInterface(
				def,
				side,
				interfaceOf(def, side).map((h) => (ids.has(h.id) ? { ...h, type: fixed } : h)),
			);
		}
		const typedBy = (item: ZoneItem) =>
			typeof item.type === "object" &&
			"variable" in item.type &&
			item.type.variable === variableId;
		if (def.nodes.some((n) => n.data.items?.some(typedBy))) {
			def.nodes = def.nodes.map((n) =>
				n.data.items?.some(typedBy)
					? {
							...n,
							data: {
								...n.data,
								items: n.data.items.map((i) =>
									typedBy(i) ? { ...i, type: fixed } : i,
								),
							},
						}
					: n,
			);
			indexDocument(def);
		}
		def.typeVariables = def.typeVariables.filter((v) => v.id !== variableId);
		this.fitTypeOwners(def);
		this.forEachInstance(definitionRef, (node) =>
			node.data.types?.[variableId]
				? {
						...node,
						data: {
							...node.data,
							types: withEntry<WgslType>(node.data.types, variableId, undefined),
						},
					}
				: node,
		);
		this.rebuildTypeCache();
	}

	/**
	 * A group node's type variables: the type each takes, the one forced on
	 * the node if any, and whether links can decide it (it has input sockets).
	 */
	variableChoices(
		nodeId: string,
		path?: readonly string[],
	): {
		variable: TypeVariable;
		type: WgslType;
		inferred: WgslType;
		forced: WgslType | undefined;
		inferable: boolean;
	}[] {
		const node = this.resolveNode(nodeId);
		const def = node?.group && this.project.definitions.get(node.group.definitionRef);
		if (!node || !def) return [];
		const doc = this.documentOf(nodeId);
		const incoming = doc?.edgesByTarget.get(nodeId) ?? [];
		const bindings = this.viewBindings(nodeId, path);
		// The type cache keeps front ends following types decided upstream.
		const resolved =
			this.typesAt(path).get(nodeId) ??
			this.typeResolver.resolveNodeTypes(node, incoming, bindings);
		const unforced = this.typeResolver.resolveNodeTypesUncached(
			node,
			incoming,
			{ ...node.data, types: undefined },
			bindings,
		);
		return def.typeVariables.map((variable) => {
			const inferable = def.inputs.some(
				(h) =>
					typeof h.type === "object" &&
					"variable" in h.type &&
					h.type.variable === variable.id,
			);
			const fallback = variable.types[0] ?? "f32";
			return {
				variable,
				type: resolved.bindings?.[variable.id] ?? fallback,
				inferred: inferable ? (unforced.bindings?.[variable.id] ?? fallback) : fallback,
				forced: node.data.types?.[variable.id],
				inferable,
			};
		});
	}

	/** Force a group node's type variable to `type`, or back to inference with `undefined`. */
	setVariableType(nodeId: string, variableId: string, type: WgslType | undefined) {
		const node = this.resolveNode(nodeId);
		if (node?.type !== "node-group") return;
		this.updateNodeData(nodeId, { types: withEntry(node.data.types, variableId, type) });
	}

	/** The inputs and outputs of a group typed by a variable. */
	private handlesOfVariable(def: HydratedGraphDocument, variableId: string): Set<string> {
		return new Set(
			[...def.inputs, ...def.outputs]
				.filter(
					(h) =>
						typeof h.type === "object" &&
						"variable" in h.type &&
						h.type.variable === variableId,
				)
				.map((h) => h.id),
		);
	}

	/** Replace the group nodes of a definition, in every document, through `update`. */
	private forEachInstance(definitionRef: string, update: (node: GraphNode) => GraphNode) {
		for (const doc of this.project.definitions.values()) {
			const nodes = doc.nodes.map((n) =>
				n.group?.definitionRef === definitionRef ? update(n) : n,
			);
			if (nodes.some((n, i) => n !== doc.nodes[i])) this.setContent(doc, { nodes });
		}
	}

	/**
	 * Remove the links of a group's handles that no longer fit their types,
	 * inside the definition and on every group node of it.
	 */
	private dropUnfitLinks(definitionRef: string, handleIds: ReadonlySet<string>) {
		const def = this.project.definitions.get(definitionRef);
		if (!def || handleIds.size === 0) return;
		const boundary = (id: string) => BOUNDARY_TYPES.has(def.nodesById.get(id)?.type ?? "");
		const touches = (doc: HydratedGraphDocument, e: GraphEdge) => {
			if (doc === def) {
				return (
					(boundary(e.source) && handleIds.has(e.sourceHandle)) ||
					(boundary(e.target) && handleIds.has(e.targetHandle))
				);
			}
			const isInstance = (id: string) =>
				doc.nodesById.get(id)?.group?.definitionRef === definitionRef;
			return (
				(isInstance(e.source) && handleIds.has(e.sourceHandle)) ||
				(isInstance(e.target) && handleIds.has(e.targetHandle))
			);
		};
		let changed = false;
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
				changed = true;
			}
		}
		if (changed) this.rebuildTypeCache();
	}

	/**
	 * Make a group input an enum choosing among `variants` (it becomes a u32),
	 * or a plain value again with `undefined`. Match nodes linked to it follow:
	 * links into cases it no longer has are removed.
	 */
	setHandleVariants(
		definitionRef: string,
		handleId: string,
		variants: EnumVariant[] | undefined,
	) {
		if (variants) this.setHandleType(definitionRef, "input", handleId, "u32");
		const handles = this.project.definitions.get(definitionRef)?.inputs ?? [];
		const changed = this.updateHandle(definitionRef, "input", handleId, (h) => {
			const rest = { ...h };
			delete rest.variants;
			return variants ? { ...rest, variants } : rest;
		});
		if (!changed) return;
		this.rebuildTypeCache();

		// The inputs of removed variants go with them.
		const kept = new Set((variants ?? []).map((v) => v.value));
		const orphans = handles.filter((h) =>
			ownerChain(handles, h).some((o) => o.enumId === handleId && !kept.has(o.value)),
		);
		this.removeHandles(
			definitionRef,
			"input",
			orphans.map((h) => h.id),
		);
	}

	/**
	 * Remove an input or output of a group, with its links. Removing an enum
	 * removes its variants' inputs too.
	 */
	removeHandle(definitionRef: string, side: GroupSide, handleId: string) {
		const handles = interfaceOf(this.project.definitions.get(definitionRef), side);
		if (!handles.some((h) => h.id === handleId)) return;
		const under = handles.filter((h) => isUnder(handles, h, { enumId: handleId }));
		this.removeHandles(definitionRef, side, [handleId, ...under.map((h) => h.id)]);
	}

	protected removeHandles(definitionRef: string, side: GroupSide, ids: readonly string[]) {
		const def = this.project.definitions.get(definitionRef);
		if (!def || ids.length === 0) return;
		const removed = new Set(ids);
		this.setInterface(
			def,
			side,
			interfaceOf(def, side).filter((h) => !removed.has(h.id)),
		);
		if (side === "input") {
			def.defaults = Object.fromEntries(
				Object.entries(def.defaults).filter(([id]) => !removed.has(id)),
			);
		}

		// The links to them on every boundary node of that side.
		const boundary = (id: string) => sideOf(def.nodesById.get(id)) === side;
		this.setContent(def, {
			edges: def.edges.filter(
				(e) =>
					!(
						(boundary(e.source) && removed.has(e.sourceHandle)) ||
						(boundary(e.target) && removed.has(e.targetHandle))
					),
			),
		});

		// Remove all *outer* edges in any document that holds an instance of this
		// definition: the now-deleted handles no longer exist on the group node,
		// so any edge referencing them would be dangling and crash the renderer.
		for (const id of ids) this.removeOuterEdgesForHandle(definitionRef, id);

		// Rebuild types since handles and cross-document edges changed
		this.rebuildTypeCache();
	}

	/**
	 * Delete every edge in the project that connects to a group node instance of
	 * `definitionRef` via the given `handleId`. Without this, deleting a handle
	 * from a group's definition leaves dangling edges in parent documents.
	 */
	protected removeOuterEdgesForHandle(definitionRef: string, handleId: string) {
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

/**
 * `owner` within the types its variable may take, or undefined once it
 * owns none of them, or all: either way it hides nothing.
 */
/** `owned` with `typeOwner`, or without one. */
function withTypeOwner<T extends { typeOwner?: TypeOwner }>(
	owned: T,
	typeOwner: TypeOwner | undefined,
): T {
	const rest = { ...owned };
	delete rest.typeOwner;
	return typeOwner ? { ...rest, typeOwner } : rest;
}

function fitTypeOwner(owner: TypeOwner, allowed: readonly WgslType[]): TypeOwner | undefined {
	const types = allowed.filter((t) => owner.types.includes(t));
	return types.length === 0 || types.length === allowed.length
		? undefined
		: { variable: owner.variable, types };
}
