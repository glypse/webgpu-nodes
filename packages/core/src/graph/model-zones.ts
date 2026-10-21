import { type HandleDef, type WgslType } from "../types";
import {
	DEFAULT_ITERATIONS,
	DEFAULT_MAX_ITERATIONS,
	NEW_ITEM_HANDLE,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	analyzeZones,
	pairedOutputId,
	zoneItems,
} from "../zones";
import { type GraphEdge, type GraphNode, type HydratedGraphDocument } from "./document";
import { indexDocument } from "./hydrate";
import { GraphModelBase } from "./model-base";

/** Horizontal distance between a new zone's input and output nodes. */
export const ZONE_SPACING = 450;

/** Repeat zone editing. */
export abstract class ZoneModel extends GraphModelBase {
	/** Whether an edge of the active document breaks zone rules (drawn red, ignored by codegen). */
	isEdgeInvalid(edgeId: string): boolean {
		return this.activeZones.invalidEdges.has(edgeId);
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
		const after = analyzeZones(doc.nodes, [...kept, candidate]).invalidEdges;
		for (const id of after) if (!before.has(id)) return false;
		return true;
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
	protected zoneNodes(zoneId: string): { input: GraphNode; output: GraphNode } | undefined {
		const doc = this.activeDocument;
		const input = doc.nodesById.get(zoneId);
		const output = input ? doc.nodesById.get(pairedOutputId(input) ?? "") : undefined;
		if (input?.type !== REPEAT_INPUT || output?.type !== REPEAT_OUTPUT) return undefined;
		return { input, output };
	}

	getZoneItems(zoneId: string): HandleDef[] {
		return zoneItems(this.zoneNodes(zoneId)?.output);
	}

	/** Write a zone's item list (on its output node) and refresh everything derived from it. */
	protected setZoneItems(zoneId: string, items: HandleDef[]) {
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
}
