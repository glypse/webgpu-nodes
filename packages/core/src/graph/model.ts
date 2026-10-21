import * as v from "valibot";

import type { AddMenuEntry } from "../catalog/add-menu";
import { defaultDataForType, nodeRegistry } from "../nodes/registry";
import { type WgslType, familyKey, isConnectionCompatible, isWgslType, typeKind } from "../types";
import { NEW_ITEM_HANDLE, pairedOutputId, wouldCreateCycle } from "../zones";
import { type GraphEdge, type GraphNode, type GraphProject } from "./document";
import { stableStringify } from "./editing";
import { History } from "./history";
import { indexDocument, serialiseDocument } from "./hydrate";
import { emptyProject } from "./model-base";
import { GroupModel } from "./model-groups";
import { ZONE_SPACING } from "./model-zones";
import { GraphProjectSchema } from "./schema";

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

/**
 * The whole editable project, headless: documents and groups, repeat zones,
 * type inference, connection rules and undo history. Every edit a front end
 * offers goes through here, and `generateShader` compiles it.
 *
 * Front ends subclass it to plug in their own reactivity, by overriding the
 * `create*` factories (state, documents, history counts).
 */
export class GraphModel extends GroupModel {
	/** Content snapshots of past states (see `contentSnapshot`). */
	readonly history = new History(this.createHistoryCounts());

	constructor(project: GraphProject = emptyProject()) {
		super();
		this.setProject(project);
		this.markSaved();
		this.history.reset(this.contentSnapshot());
	}

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
