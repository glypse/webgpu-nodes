import { defaultSizeValues, itemSizeHandles, itemSizeInputIds } from "../passes/item-size";
import type { TextureFormat } from "../passes/textures";
import { isTexture, type SocketType, type WgslType, type ZoneItem } from "../types";
import {
	analyzeZones,
	carriesItem,
	clampIterations,
	DEFAULT_ITERATIONS,
	DEFAULT_MAX_ITERATIONS,
	FIXED_ZONE_HANDLES,
	inferredItemFamily,
	isZoneInput,
	ITERATIONS_HANDLE,
	keepsTextures,
	NEW_ITEM_HANDLE,
	pairedOutputId,
	REPEAT_INPUT,
	sizeNodeOf,
	SKIP_HANDLE,
	ZONE_BOUNDARIES,
	zoneItems,
	type ZoneKind,
	zoneKindOf,
	zoneOptions,
} from "../zones";
import { type GraphEdge, type GraphNode, type HydratedGraphDocument } from "./document";
import { indexDocument } from "./hydrate";
import { GraphModelBase, withEntry } from "./model-base";

/** Horizontal distance between a new zone's input and output nodes. */
export const ZONE_SPACING = 450;

/** Zone editing. */
export abstract class ZoneModel extends GraphModelBase {
	/** Whether an edge of the active document breaks zone rules (drawn red, ignored by codegen). */
	isEdgeInvalid(edgeId: string): boolean {
		return this.activeZones.invalidEdges.has(edgeId);
	}

	/** Why a link breaks a nesting rule, if it does; other invalid links have no reason here. */
	zoneLinkReason(edgeId: string): string | undefined {
		return this.activeZones.reasons.get(edgeId);
	}

	/**
	 * Simulate adding `candidate` (replacing whatever already feeds a
	 * non-variadic target) and check that neither it nor any existing link
	 * ends up breaking zone rules.
	 */
	protected respectsZones(
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
		const after = analyzeZones(
			doc.nodes,
			[...kept, candidate],
			zoneOptions(this.project.definitions),
		).invalidEdges;
		for (const id of after) if (!before.has(id)) return false;
		return true;
	}

	/**
	 * Add a new zone (paired input/output nodes) to the active document, with
	 * one inferred state item passed straight through. Returns its input's
	 * id, or undefined if the document is locked.
	 */
	createZone(kind: ZoneKind, position: { x: number; y: number }): string | undefined {
		if (this.isLocked) return undefined;
		const inputId = this.newId();
		const outputId = this.newId();
		const item: ZoneItem = {
			id: this.newId(),
			label: "Value",
			type: { inferred: true },
		};
		const { input, output } = ZONE_BOUNDARIES[kind];
		const counted = kind !== "simulation";

		const nodes: GraphNode[] = [
			{
				id: inputId,
				type: input,
				data: {
					pairedOutput: outputId,
					values: {
						...(counted ? { [ITERATIONS_HANDLE]: DEFAULT_ITERATIONS } : {}),
						[item.id]: 0,
					},
					...(kind === "repeat" ? { maxIterations: DEFAULT_MAX_ITERATIONS } : {}),
				},
				position,
			},
			{
				id: outputId,
				type: output,
				data: {
					items: [item],
					...(kind === "simulation" ? { values: { [SKIP_HANDLE]: false } } : {}),
				},
				position: { x: position.x + ZONE_SPACING, y: position.y },
			},
		];
		const passthrough: GraphEdge = {
			id: this.newId(),
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

	/** Add a new repeat zone (see `createZone`). */
	createRepeatZone(position: { x: number; y: number }): string | undefined {
		return this.createZone("repeat", position);
	}

	/** Add a new simulation zone (see `createZone`). */
	createSimulationZone(position: { x: number; y: number }): string | undefined {
		return this.createZone("simulation", position);
	}

	/** The kind of a zone of the active document, by its input's id. */
	zoneKind(zoneId: string): ZoneKind | undefined {
		return this.zoneNodes(zoneId)?.kind;
	}

	/** The paired input / output nodes of a zone in the active document. */
	protected zoneNodes(
		zoneId: string,
	): { input: GraphNode; output: GraphNode; kind: ZoneKind } | undefined {
		const doc = this.activeDocument;
		const input = doc.nodesById.get(zoneId);
		const output = input ? doc.nodesById.get(pairedOutputId(input) ?? "") : undefined;
		const kind = zoneKindOf(input?.type);
		if (!input || !output || !kind || !isZoneInput(input.type)) return undefined;
		if (output.type !== ZONE_BOUNDARIES[kind].output) return undefined;
		return { input, output, kind };
	}

	getZoneItems(zoneId: string): ZoneItem[] {
		return zoneItems(this.zoneNodes(zoneId)?.output);
	}

	/** Write a zone's item list (on its output node) and refresh everything derived from it. */
	protected setZoneItems(zoneId: string, items: ZoneItem[]) {
		const zone = this.zoneNodes(zoneId);
		if (!zone || this.isLocked || !items.every((i) => carriesItem(zone.kind, i))) return;
		const patches = new Map<string, Record<string, unknown>>([
			[zone.output.id, { ...zone.output.data, items }],
		]);
		this.patchNodeData(patches);

		// Drop links to items that no longer exist or no longer fit their type.
		const ids = new Set(items.map((i) => i.id));
		const doc = this.activeDocument;
		const boundary = new Set([zone.input.id, zone.output.id]);
		const fixed = FIXED_ZONE_HANDLES;
		const sizes = itemSizeInputIds(items);
		doc.edges = doc.edges.filter((e) => {
			if (
				boundary.has(e.target) &&
				!fixed.has(e.targetHandle) &&
				!ids.has(e.targetHandle) &&
				!(
					e.target === sizeNodeOf(zone.kind, zone.input, zone.output).id &&
					sizes.has(e.targetHandle)
				)
			) {
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
	addZoneItem(zoneId: string, type: ZoneItem["type"], label?: string): ZoneItem | undefined {
		const zone = this.zoneNodes(zoneId);
		if (!zone || this.isLocked || !carriesItem(zone.kind, { type })) return undefined;
		const items = zoneItems(zone.output);
		const existing = new Set(items.map((i) => i.label));
		let name = label ?? "Value";
		for (let n = 2; existing.has(name); n++) name = `${label ?? "Value"} ${String(n)}`;
		const item: ZoneItem = { id: this.newId(), label: name, type };
		this.setZoneItems(zoneId, [...items, item]);
		return item;
	}

	removeZoneItem(zoneId: string, itemId: string) {
		const items = this.getZoneItems(zoneId).filter((i) => i.id !== itemId);
		this.pickItemType(zoneId, itemId, undefined);
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

	/**
	 * Change a state item's type; links that no longer fit are removed. An
	 * item becoming inferred keeps its type until its initial value is linked.
	 */
	setZoneItemType(zoneId: string, itemId: string, type: ZoneItem["type"]) {
		const items = this.getZoneItems(zoneId);
		const inferred = typeof type === "object" && "inferred" in type;
		const current = this.resolveOutputHandleType(zoneId, itemId);
		this.pickItemType(zoneId, itemId, inferred && !isTexture(current) ? current : undefined);
		this.setZoneItems(
			zoneId,
			items.map((i) => (i.id === itemId ? { ...i, type } : i)),
		);
	}

	/**
	 * Set the format a simulation's or passes zone's item is kept in, or
	 * (`undefined`) the one its type has by default. A repeat zone's items
	 * aren't kept in textures.
	 */
	setZoneItemFormat(zoneId: string, itemId: string, format: TextureFormat | undefined) {
		if (!keepsTextures(this.zoneKind(zoneId))) return;
		this.setZoneItems(
			zoneId,
			this.getZoneItems(zoneId).map((item) => {
				if (item.id !== itemId) return item;
				const next: ZoneItem = { ...item };
				if (format === undefined) delete next.format;
				else next.format = format;
				return next;
			}),
		);
	}

	/**
	 * Set how a simulation's or passes zone's item is sized, or (`undefined`)
	 * to the canvas' size. Its size inputs follow the
	 * mode, and links to those it no longer has are dropped.
	 */
	setZoneItemSize(zoneId: string, itemId: string, size: ZoneItem["size"]) {
		const zone = this.zoneNodes(zoneId);
		if (!zone || !keepsTextures(zone.kind) || this.isLocked) return;
		const input = sizeNodeOf(zone.kind, zone.input, zone.output);
		const handle = size === undefined ? undefined : itemSizeHandles(itemId)[size];
		const unset = handle === undefined ? false : input.data.values?.[handle] === undefined;
		if (size !== undefined && unset) {
			const values = {
				...input.data.values,
				...defaultSizeValues(itemSizeHandles(itemId), size),
			};
			this.patchNodeData(new Map([[input.id, { ...input.data, values }]]));
		}
		this.setZoneItems(
			zoneId,
			this.getZoneItems(zoneId).map((item) => {
				if (item.id !== itemId) return item;
				const next: ZoneItem = { ...item };
				if (size === undefined) delete next.size;
				else next.size = size;
				return next;
			}),
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

	/**
	 * Pick the type an inferred item takes while its initial value is
	 * unlinked (or forget it, with `undefined`).
	 */
	private pickItemType(zoneId: string, itemId: string, type: WgslType | undefined) {
		const zone = this.zoneNodes(zoneId);
		if (!zone || this.isLocked) return;
		const key = inferredItemFamily(itemId);
		if (zone.input.data.types?.[key] === type) return;
		const types = withEntry<SocketType>(zone.input.data.types, key, type);
		this.patchNodeData(new Map([[zone.input.id, { ...zone.input.data, types }]]));
	}

	/** Set a repeat zone's iteration safety cap. */
	setZoneMaxIterations(zoneId: string, max: number) {
		const zone = this.zoneNodes(zoneId);
		if (zone?.input.type !== REPEAT_INPUT || this.isLocked) return;
		const value = clampIterations(max);
		this.patchNodeData(
			new Map([[zone.input.id, { ...zone.input.data, maxIterations: value }]]),
		);
	}

	/**
	 * Complete a connection dropped on a zone's virtual "new item" handle:
	 * create an inferred item, then link to it. Unless the link is its initial
	 * value, the item takes the type at the other end until one is linked. A
	 * texture makes a simulation zone's texture item, and no repeat zone's.
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

		let type: SocketType;
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
		const item = this.addZoneItem(zoneId, isTexture(type) ? type : { inferred: true }, label);
		if (!item) return true;
		if (!isTexture(type) && !(toNew && connection.target === zoneId)) {
			this.pickItemType(zoneId, item.id, type);
		}

		const edge: GraphEdge = {
			id: this.newId(),
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
	 * Zone nodes always go in pairs: extend a deletion to the partner of every
	 * deleted zone node, and to the edges connected to those partners.
	 */
	expandDeletion(
		nodes: readonly { id: string }[],
		edges: readonly GraphEdge[],
	): { nodes: { id: string }[]; edges: GraphEdge[] } {
		const doc = this.activeDocument;
		const zones = this.activeZones;
		const nodeIds = new Set(nodes.map((n) => n.id));
		const extraNodes: { id: string }[] = [];
		for (const node of nodes) {
			const zone = zones.zones.get(zones.zoneOfBoundary.get(node.id) ?? "");
			if (!zone) continue;
			for (const partnerId of [zone.inputId, zone.outputId]) {
				if (nodeIds.has(partnerId)) continue;
				const partner = doc.nodesById.get(partnerId);
				if (!partner) continue;
				nodeIds.add(partnerId);
				extraNodes.push(partner);
			}
		}
		const edgeIds = new Set(edges.map((e) => e.id));
		const extraEdges = doc.edges.filter(
			(e) => !edgeIds.has(e.id) && (nodeIds.has(e.source) || nodeIds.has(e.target)),
		);
		return { nodes: [...nodes, ...extraNodes], edges: [...edges, ...extraEdges] };
	}
}
