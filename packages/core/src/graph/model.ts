import * as v from "valibot";

import { type AddMenuEntry, withOptions } from "../catalog/add-menu";
import { enumOfOutput, MATCH, MATCH_SELECTOR } from "../enums";
import { LAYOUT_FRAME } from "../frames";
import {
	computeLayout,
	estimateFrameHeader,
	estimateNodeGeometry,
	type LayoutSpacing,
	type NodeGeometry,
	type NodeRows,
} from "../layout";
import { defaultDataForType, nodeRegistry, type NodeType } from "../nodes/registry";
import { PassAnalysis } from "../passes/analysis";
import { err, ok } from "../result";
import {
	isSocketCompatible,
	isTexture,
	type NodeData,
	type NodeWidget,
	pickableTypes,
	socketKind,
	type SocketType,
	withDefaults,
} from "../types";
import {
	isZoneNodeType,
	NEW_ITEM_HANDLE,
	pairedOutputId,
	wouldCreateCycle,
	zoneKindOf,
} from "../zones";
import { rerouteBranches } from "./branches";
import {
	type GraphEdge,
	type GraphNode,
	type GraphProject,
	type HydratedGraphDocument,
	ROOT_ID,
} from "./document";
import { BOUNDARY_TYPES, stableStringify } from "./editing";
import { History } from "./history";
import { hydrateNode, indexDocument, serialiseDocument } from "./hydrate";
import { AssetModel, MEDIA_NODE_OF } from "./model-assets";
import { emptyProject, withEntry } from "./model-base";
import { ZONE_SPACING } from "./model-zones";
import { GraphProjectSchema } from "./schema";
import { type LoadResult, parseJson, type ValidatedProject, validateProject } from "./validate";

/** Rows a widget takes, for estimating node sizes. */
const WIDGET_ROWS: Record<NodeWidget["kind"], number> = {
	// The colour wheel and its value ramp.
	color: 6,
	// The graph, the selected point's tools and its coordinates.
	curve: 10,
	// The tools, the gradient with its stops, and the selected stop's position.
	ramp: 4,
	// The signature line and the code editor's default height.
	code: 5,
	// The case count and its buttons.
	cases: 1,
	// The thumbnail and the asset picker.
	asset: 5,
};

export type TypeChoice = {
	types: readonly SocketType[];
	/** Whether links can decide the type (otherwise it's always picked). */
	inferable: boolean;
	/** The type the user picked, if any. */
	forced: SocketType | undefined;
	/** The type the node has without a pick. */
	inferred: SocketType;
};

/**
 * The whole editable project, headless: documents and groups, repeat zones,
 * type inference, connection rules and undo history. Every edit a front end
 * offers goes through here, and `generateShader` compiles it.
 *
 * Front ends subclass it to plug in their own reactivity, by overriding the
 * `create*` factories (state, documents, history counts).
 */
export class GraphModel extends AssetModel {
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
	 * Restore a content snapshot, keeping each document's camera, the panels,
	 * and as much of the graph areas' paths as still exists.
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
		this.setProject(parsed.output, { keepScreen: true });
		for (const [key, doc] of this.project.definitions) {
			doc.viewport ??= viewports.get(key);
		}
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
		return stableStringify({ definitions, settings: this.settings, assets: this.assets });
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
	 * - connections breaking zone rules, or invalidating existing links,
	 * - anything but an enum picking a Match node's case.
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
		} else if (
			isTexture(
				targetHandle === NEW_ITEM_HANDLE
					? this.resolveOutputHandleType(sourceNode.id, sourceHandle)
					: this.resolveInputType(targetNode.id, targetHandle),
			) &&
			zoneKindOf((targetHandle === NEW_ITEM_HANDLE ? targetNode : sourceNode).type) !==
				"simulation"
		) {
			// Only a simulation zone carries a texture.
			return false;
		}
		// A Match node's cases come from its enum: nothing else can pick one.
		if (
			targetNode.type === MATCH &&
			targetHandle === MATCH_SELECTOR &&
			!enumOfOutput(doc, connection.source, sourceHandle)
		) {
			return false;
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
		// A group's output is linked on one of its Group Output nodes at a time.
		const output = targetNode?.type === "group-output";
		const replaced = (e: GraphEdge) =>
			e.targetHandle === connection.targetHandle &&
			(e.target === connection.target ||
				(output && doc.nodesById.get(e.target)?.type === "group-output")) &&
			(!variadic ||
				(e.source === connection.source && e.sourceHandle === connection.sourceHandle));
		const edge: GraphEdge = { id: crypto.randomUUID(), ...connection };
		doc.edges = [...doc.edges.filter((e) => !replaced(e)), edge];
		indexDocument(doc);
		this.rebuildTypeCache();
	}

	/**
	 * The entries a link dragged from `pending` can be dropped into. A node
	 * whose type is picked rather than inferred comes as one entry per type
	 * with a handle of exactly the dragged type, e.g. "Declare vec3f" to feed
	 * a vec3f input, or "Declare vec2f" … "Declare vec4f" to take an f32. A
	 * variant of the dragged type itself would only pass the value through,
	 * so it isn't offered. Options picked in search are checked against the
	 * link separately (see `entryHandleFor`).
	 */
	connectableEntries(
		entries: readonly AddMenuEntry[],
		pending: PendingConnection,
	): AddMenuEntry[] {
		const fromOutput = pending.handleType === "source";
		const value = fromOutput
			? this.resolveOutputHandleType(pending.nodeId, pending.handleId)
			: this.resolveInputType(pending.nodeId, pending.handleId);
		const typedOf = (entry: AddMenuEntry): AddMenuEntry[] => {
			const family =
				entry.kind === "node" ? nodeRegistry[entry.type ?? ""]?.typeFamily : undefined;
			if (!family) return [];
			const others = entry.choices.filter((choice) =>
				choice.every((o) => o.data.types?.[family.key] === undefined),
			);
			return family.types.flatMap((type) => {
				if (fromOutput && type === value) return [];
				const variant = {
					...withOptions(entry, [
						{ label: type, data: { types: { [family.key]: type } }, isDefault: false },
					]),
					choices: others,
				};
				const fresh = this.freshNodeTypes(variant);
				const exact = fromOutput
					? fresh?.resolvedInputs.some((input) => input.types.includes(value))
					: fresh?.resolvedOutputs.some((output) => output.type === value);
				return exact ? [variant] : [];
			});
		};
		return entries.flatMap((entry) => {
			const typed = typedOf(entry);
			if (typed.length > 0) return typed;
			return this.entryHandleFor(entry, pending) === undefined ? [] : [entry];
		});
	}

	/**
	 * The handle of a freshly created `entry` that a link being dragged from
	 * `pending` would connect to, or undefined if nothing fits. Handles whose
	 * scalar kind matches the dragged value are preferred.
	 */
	entryHandleFor(entry: AddMenuEntry, pending: PendingConnection): string | undefined {
		if (entry.kind === "zone") return NEW_ITEM_HANDLE;
		if (entry.kind === "link") {
			const link = entry.source && {
				source: entry.source,
				sourceHandle: "out",
				target: pending.nodeId,
				targetHandle: pending.handleId,
			};
			return pending.handleType === "target" && link && this.isValidConnection(link)
				? "out"
				: undefined;
		}
		if (entry.kind === "node" && entry.type === "node-group") return undefined;

		const fresh = this.freshNodeTypes(entry);
		if (!fresh) return undefined;
		const rank = (
			candidates: readonly SocketType[],
			value: SocketType,
			valueIsSource: boolean,
		) => {
			const fits = candidates.filter((t) =>
				valueIsSource ? isSocketCompatible(value, t) : isSocketCompatible(t, value),
			);
			if (fits.length === 0) return 2;
			return fits.some((t) => socketKind(t) === socketKind(value)) ? 0 : 1;
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
		let node: GraphNode;
		if (entry.kind === "group" && entry.definitionRef) {
			node = {
				id: FRESH_ID,
				type: "node-group",
				data: entry.data ?? {},
				position: { x: 0, y: 0 },
				group: { definitionRef: entry.definitionRef, locked: true },
			};
		} else if (entry.type && nodeRegistry[entry.type]) {
			node = {
				id: FRESH_ID,
				type: entry.type,
				data: entryNodeData(entry.type, entry.data),
				position: { x: 0, y: 0 },
			};
		} else return undefined;
		return this.typeResolver.resolveNodeTypesUncached(node, [], node.data);
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
		// A named reroute is linked to straight away, wherever it is.
		if (entry.kind === "link") {
			if (!handle || !entry.source) return undefined;
			this.connect({
				source: entry.source,
				sourceHandle: handle,
				target: pending.nodeId,
				targetHandle: pending.handleId,
			});
			return entry.source;
		}
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

	private passCache: { inputs: readonly unknown[]; analysis: PassAnalysis } | undefined;

	/**
	 * The graph's textures as compiled (see `PassAnalysis`), memoised on the
	 * documents' nodes and edges, the assets and the types.
	 */
	passAnalysis(): PassAnalysis {
		const inputs = [
			this.assets,
			this.state.typeCaches,
			...[...this.project.definitions.values()].flatMap((d) => [d.nodes, d.edges]),
		];
		const cached = this.passCache;
		if (
			cached?.inputs.length === inputs.length &&
			cached.inputs.every((x, i) => x === inputs[i])
		) {
			return cached.analysis;
		}
		const analysis = new PassAnalysis(this);
		this.passCache = { inputs, analysis };
		return analysis;
	}

	get nodes(): GraphNode[] {
		return this.activeDocument.nodes;
	}

	set nodes(value: GraphNode[]) {
		this.setDocumentNodes(this.activeDefinitionRef, value);
	}

	get edges(): GraphEdge[] {
		return this.activeDocument.edges;
	}

	set edges(value: GraphEdge[]) {
		this.setDocumentEdges(this.activeDefinitionRef, value);
	}

	/** Replace a document's nodes (e.g. as a canvas moves or selects them). */
	setDocumentNodes(definitionRef: string, nodes: GraphNode[]) {
		const doc = this.project.definitions.get(definitionRef);
		if (!doc) return;
		doc.nodes = nodes;
		indexDocument(doc);
	}

	/** Replace a document's edges, re-resolving types. */
	setDocumentEdges(definitionRef: string, edges: GraphEdge[]) {
		const doc = this.project.definitions.get(definitionRef);
		if (!doc) return;
		doc.edges = edges;
		indexDocument(doc);
		this.rebuildTypeCache();
	}

	/** Check saved JSON against every rule of a project, changing nothing. */
	parseProject(text: string): LoadResult<ValidatedProject> {
		const json = parseJson(text);
		return json.ok ? this.validate(json.value) : json;
	}

	private validate(project: unknown): LoadResult<ValidatedProject> {
		return validateProject(project, (ref) => this.isStandardLibrary(ref));
	}

	/**
	 * Replace the project, once the library versions it uses are fetched. If
	 * it fails the current project stays, as it was.
	 */
	async commitProject(project: ValidatedProject): Promise<LoadResult> {
		const { settings, assets } = this.state;
		const { project: current, screen, typeResolver } = this;
		try {
			await this.fetchArchivedVersions(Object.values(project.definitions));
			this.setProject(project);
			this.markSaved();
			this.history.reset(this.contentSnapshot());
			return ok(undefined);
		} catch (error) {
			console.error("[graph] failed to load a project", error);
			this.project = current;
			this.state.settings = settings;
			this.state.assets = assets;
			this.typeResolver = typeResolver;
			this.setScreen(screen);
			this.rebuildTypeCache();
			return err({
				kind: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** Replace the project with parsed saved JSON; see `commitProject`. */
	async loadProject(project: unknown): Promise<LoadResult> {
		const validated = this.validate(project);
		return validated.ok ? this.commitProject(validated.value) : validated;
	}

	/**
	 * The project as saved: the user's documents (the standard library being
	 * the app's own), its settings and its panels.
	 */
	getProjectJson(): string {
		const definitions = Object.fromEntries(
			[...this.project.definitions.entries()]
				.filter(([key]) => !this.isStandardLibrary(key))
				.map(([key, definition]) => [
					key,
					serialiseDocument(definition, { viewport: true }),
				]),
		);
		const project: GraphProject = {
			definitions,
			settings: this.settings,
			layout: this.screen,
			assets: [...this.assets],
		};
		return JSON.stringify(project, null, "\t");
	}

	/** Replace the project with saved JSON; see `commitProject`. */
	async loadFromString(text: string): Promise<LoadResult> {
		const validated = this.parseProject(text);
		return validated.ok ? this.commitProject(validated.value) : validated;
	}

	/**
	 * Add a node of a registered type to the active document.
	 * Returns its id, or undefined if the document is locked.
	 */
	addNode(
		type: NodeType,
		position: { x: number; y: number },
		data: NodeData = defaultDataForType(type),
	): string | undefined {
		if (this.isLocked) return undefined;
		const id = crypto.randomUUID();
		const doc = this.activeDocument;
		doc.nodes = [...doc.nodes, { id, type, data, position }];
		indexDocument(doc);
		this.rebuildTypeCache();
		return id;
	}

	/**
	 * Add an Image or Video node reading an asset at `position` (flow
	 * coordinates). Returns its id, if any.
	 */
	addAssetNode(assetId: string, position: { x: number; y: number }): string | undefined {
		const asset = this.asset(assetId);
		if (!asset) return undefined;
		return this.addNode(MEDIA_NODE_OF[asset.kind], position, { asset: asset.id });
	}

	/**
	 * Assets dropped at `position` on the active document: onto an Image or
	 * Video node (`onto`), the first of their kind becomes what it reads;
	 * elsewhere, each gets a node of its own, one under the other. Returns
	 * the ids of the nodes changed or added.
	 */
	dropAssets(
		assetIds: readonly string[],
		position: { x: number; y: number },
		onto?: string,
	): string[] {
		const target = onto === undefined ? undefined : this.activeDocument.nodesById.get(onto);
		const fitting =
			target &&
			assetIds.find((id) => {
				const asset = this.asset(id);
				return asset && MEDIA_NODE_OF[asset.kind] === target.type;
			});
		if (target && fitting) {
			this.setNodeAsset(target.id, fitting);
			return [target.id];
		}
		return assetIds.flatMap((id, i) => {
			const added = this.addAssetNode(id, {
				x: position.x,
				y: position.y + i * DROPPED_NODE_SPACING,
			});
			return added ? [added] : [];
		});
	}

	/**
	 * Create what an add-menu entry stands for at `position` (flow coordinates).
	 * Returns the id of the created node (a zone's input), if any.
	 */
	addMenuEntry(entry: AddMenuEntry, position: { x: number; y: number }): string | undefined {
		if (entry.disabled) return undefined;
		switch (entry.kind) {
			case "zone":
				return this.createZone(entry.zone ?? "repeat", position);
			case "group":
				return entry.definitionRef
					? this.addFromLibrary(entry.definitionRef, position, entry.data)
					: undefined;
			case "node":
				if (entry.type === "node-group") return this.createGroup(position);
				return entry.type
					? this.addNode(entry.type, position, entryNodeData(entry.type, entry.data))
					: undefined;
			case "link": {
				const source = entry.source;
				if (!source || !this.activeDocument.nodesById.has(source)) return undefined;
				const reroute = this.addNode("reroute", position, defaultDataForType("reroute"));
				if (reroute) {
					this.connect({
						source,
						sourceHandle: "out",
						target: reroute,
						targetHandle: "in",
					});
				}
				return reroute;
			}
		}
	}

	/**
	 * What a node's type picker offers: the types of its family, the type the
	 * user forced (if any) and the type its links infer. Undefined for nodes
	 * without a choice of types.
	 */
	typeChoice(nodeId: string, path?: readonly string[]): TypeChoice | undefined {
		const node = this.resolveNode(nodeId);
		// Group nodes and their boundaries take their types from the group's
		// variables, zone nodes from their items.
		if (
			!node ||
			node.type === "node-group" ||
			BOUNDARY_TYPES.has(node.type) ||
			isZoneNodeType(node.type)
		) {
			return undefined;
		}
		const descriptor = this.resolveDescriptor(node);
		const pickable = pickableTypes(descriptor);
		if (!pickable) return undefined;
		const primary =
			descriptor.inputs.find((i) => i.id === descriptor.primaryInput) ?? descriptor.inputs[0];
		return {
			types: pickable.types,
			inferable: pickable.inferable,
			forced: node.data.types?.[pickable.key],
			inferred: !pickable.inferable
				? this.resolveNodeOutputType(nodeId, path)
				: primary
					? this.resolveInferredInputType(nodeId, primary.id, path)
					: "f32",
		};
	}

	/** Force a node's type (see `typeChoice`), or go back to inference with `undefined`. */
	setNodeType(nodeId: string, type: SocketType | undefined) {
		const node = this.resolveNode(nodeId);
		if (!node || !this.typeChoice(nodeId)) return;
		const pickable = pickableTypes(this.resolveDescriptor(node));
		if (!pickable) return;
		this.updateNodeData(nodeId, { types: withEntry(node.data.types, pickable.key, type) });
	}

	// ── Layout ──────────────────────────────────────────────────────────────────

	/**
	 * Arrange the nodes of a document (all of them, or `nodeIds` only) into
	 * columns following their links. Resolves to whether anything moved.
	 */
	async layoutDocument(
		definitionRef: string = this.activeDefinitionRef,
		options: LayoutOptions = {},
	): Promise<boolean> {
		const doc = this.project.definitions.get(definitionRef);
		if (!doc || this.isStandardLibrary(definitionRef)) return false;
		const only = options.nodeIds && new Set(options.nodeIds);
		const branched = this.rerouteBranches(doc, only);
		const nodes = only
			? doc.nodes.filter((n) => only.has(n.id) || branched.has(n.id))
			: doc.nodes;
		const positions = await computeLayout({
			nodes,
			edges: doc.edges,
			zones: this.zoneAnalysis(doc),
			frames: this.frameAnalysis(doc),
			geometry: (node) =>
				options.measure?.(definitionRef, node) ??
				(node.type === LAYOUT_FRAME
					? estimateFrameHeader(this.nodeLabel(node.id), node.data.note)
					: node.type === "reroute"
						? REROUTE_GEOMETRY
						: estimateNodeGeometry(this.nodeRows(doc, node))),
			spacing: options.spacing,
		});
		return this.applyPositions(doc, positions) || branched.size > 0;
	}

	/** Split each branching output among `only` (all if absent) at a reroute; returns those added. */
	private rerouteBranches(doc: HydratedGraphDocument, only?: ReadonlySet<string>): Set<string> {
		const { reroutes, links, moved } = rerouteBranches(
			doc.nodes,
			doc.edges,
			(id) => !only || only.has(id),
			() => crypto.randomUUID(),
			this.zoneAnalysis(doc).invalidEdges,
		);
		if (reroutes.length === 0) return new Set();
		const movedById = new Map(moved.map((e) => [e.id, e]));
		this.setContent(doc, {
			nodes: [...doc.nodes, ...reroutes.map(hydrateNode)],
			edges: [...doc.edges.map((e) => movedById.get(e.id) ?? e), ...links],
		});
		this.rebuildTypeCache();
		return new Set(reroutes.map((n) => n.id));
	}

	/** Lay out the selected nodes of the document in view, among themselves. */
	async layoutSelection(options: Omit<LayoutOptions, "nodeIds"> = {}): Promise<boolean> {
		if (this.isLocked || this.selectedNodeIds.length === 0) return false;
		return this.layoutDocument(this.activeDefinitionRef, {
			...options,
			nodeIds: this.selectedNodeIds,
		});
	}

	/** Lay out every document of the project (standard library excluded). */
	async layoutProject(options: Omit<LayoutOptions, "nodeIds"> = {}): Promise<boolean> {
		const refs = [...this.project.definitions.keys()].filter(
			(ref) => ref === ROOT_ID || !this.isStandardLibrary(ref),
		);
		const moved = await Promise.all(refs.map((ref) => this.layoutDocument(ref, options)));
		return moved.some(Boolean);
	}

	private nodeRows(doc: HydratedGraphDocument, node: GraphNode): NodeRows {
		const descriptor = this.resolveDescriptor(node);
		const linked = new Set((doc.edgesByTarget.get(node.id) ?? []).map((e) => e.targetHandle));
		const hidden = this.hiddenInputs(node.id);
		const linkedOut = new Set(
			(doc.edgesBySource.get(node.id) ?? []).map((e) => e.sourceHandle),
		);
		const shown = (id: string, linkedTo: ReadonlySet<string>) =>
			node.data.hideUnlinked !== true || linkedTo.has(id);
		return {
			header:
				(descriptor.settings?.length ?? 0) +
				(this.typeChoice(node.id) ? 1 : 0) +
				this.variableChoices(node.id).filter((c) => c.variable.types.length > 1).length,
			outputs: this.resolveNodeOutputs(node.id)
				.map((o) => o.id)
				.filter((id) => shown(id, linkedOut)),
			widget: descriptor.widget ? WIDGET_ROWS[descriptor.widget.kind] : 0,
			inputs: this.resolveNodeInputs(node.id)
				.filter((i) => !hidden.has(i.id) && shown(i.id, linked))
				.map((i) => ({
					id: i.id,
					editor: !linked.has(i.id) && !i.fallback && !i.variadic,
				})),
		};
	}

	/** Move nodes still in `doc` (it may have changed during the layout). */
	private applyPositions(
		doc: HydratedGraphDocument,
		positions: ReadonlyMap<string, { x: number; y: number }>,
	): boolean {
		const nodes = doc.nodes.map((n) => {
			const position = positions.get(n.id);
			if (!position || (position.x === n.position.x && position.y === n.position.y)) {
				return n;
			}
			return { ...n, position };
		});
		const moved = nodes.some((n, i) => n !== doc.nodes[i]);
		if (moved) this.setContent(doc, { nodes });
		return moved;
	}
}

export type LayoutOptions = {
	/** Lay out these nodes only, keeping the others in place. */
	nodeIds?: Iterable<string>;
	/**
	 * The node as the front end draws it; undefined when it can't tell (an
	 * estimate is used instead).
	 */
	measure?: (definitionRef: string, node: GraphNode) => NodeGeometry | undefined;
	spacing?: Partial<LayoutSpacing>;
};

/** A link being dragged from a handle, not dropped on another handle yet. */
export type PendingConnection = {
	nodeId: string;
	handleId: string;
	/** "source" when dragged from an output, "target" when dragged from an input. */
	handleType: "source" | "target";
};

/** Default data of a node of `type`, with an add menu entry's `data` over it. */
function entryNodeData(type: string, data: NodeData | undefined): NodeData {
	return withDefaults(data ?? {}, defaultDataForType(type));
}

/** A reroute as drawn: a dot, both its handles at its centre. */
const REROUTE_GEOMETRY: NodeGeometry = {
	width: 18,
	height: 18,
	inputs: new Map([["in", 9]]),
	outputs: new Map([["out", 9]]),
};

/** Approximate rendered node width, for placing nodes next to a drop point. */
const NODE_WIDTH = 180;

/** Vertical distance between nodes added for several dropped assets. */
const DROPPED_NODE_SPACING = 260;
