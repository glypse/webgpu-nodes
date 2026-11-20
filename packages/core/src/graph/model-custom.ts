import { caseHandle } from "../enums";
import { COLOR_RAMP, colorRampStops } from "../nodes/color-ramp";
import {
	CUSTOM_WGSL,
	type CustomSockets,
	customSockets,
	isSocketName,
	newSocketLabel,
	type SocketSide,
} from "../nodes/custom";
import { clampCases, INDEX_SWITCH, indexSwitchCases } from "../nodes/index-switch";
import {
	DEFAULT_RENDER_FORMAT,
	RENDER_LIKE,
	RENDER_PIXELS,
	RENDER_SCALE,
	RENDER_TEXTURE,
	renderTextureItems,
} from "../nodes/render-texture";
import type { TextureFormat } from "../passes/textures";
import { isRampStopId, type RampStop, sortedRampStops } from "../ramp";
import type { HandleDef, InputValue, WgslType, ZoneItem } from "../types";
import type { GraphNode } from "./document";
import { indexDocument } from "./hydrate";
import { MAX_CODE_LENGTH } from "./limits";
import { GroupModel } from "./model-groups";

/**
 * Editing nodes whose sockets are their own data: Custom WGSL nodes' code
 * and sockets, Index Switches' cases, Color Ramps' stops, Render Textures'
 * items.
 */
export abstract class CustomWgslModel extends GroupModel {
	private customNode(nodeId: string): GraphNode | undefined {
		const node = this.activeDocument.nodesById.get(nodeId);
		return node?.type === CUSTOM_WGSL && !this.isLocked ? node : undefined;
	}

	setCustomCode(nodeId: string, code: string) {
		if (!this.customNode(nodeId) || code.length > MAX_CODE_LENGTH) return;
		this.updateNodeData(nodeId, { code }, { retype: false });
	}

	/** Write a node's sockets, dropping links to sockets gone or no longer fitting their type. */
	private setCustomSockets(node: GraphNode, sockets: CustomSockets) {
		this.patchNodeData(new Map([[node.id, { ...node.data, sockets }]]));
		this.invalidateTypes([node.id]);
		const inputs = new Set(sockets.inputs.map((s) => s.id));
		const outputs = new Set(sockets.outputs.map((s) => s.id));
		const doc = this.activeDocument;
		doc.edges = doc.edges.filter((e) => {
			if (e.target === node.id && !inputs.has(e.targetHandle)) return false;
			if (e.source === node.id && !outputs.has(e.sourceHandle)) return false;
			if (e.source !== node.id && e.target !== node.id) return true;
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

	private updateSockets(
		nodeId: string,
		side: SocketSide,
		update: (sockets: HandleDef[]) => HandleDef[],
	) {
		const node = this.customNode(nodeId);
		if (!node) return;
		const sockets = customSockets(node.data);
		this.setCustomSockets(node, { ...sockets, [side]: update(sockets[side]) });
	}

	/** Append a socket with a free name; returns it. */
	addCustomSocket(nodeId: string, side: SocketSide, type: WgslType): HandleDef | undefined {
		const node = this.customNode(nodeId);
		if (!node) return undefined;
		const socket: HandleDef = {
			id: crypto.randomUUID(),
			label: newSocketLabel(customSockets(node.data), side),
			type,
		};
		this.updateSockets(nodeId, side, (sockets) => [...sockets, socket]);
		return socket;
	}

	removeCustomSocket(nodeId: string, side: SocketSide, socketId: string) {
		this.updateSockets(nodeId, side, (sockets) => sockets.filter((s) => s.id !== socketId));
	}

	/**
	 * Rename a socket, which is also the variable the code reads or writes.
	 * Rejects names that aren't WGSL identifiers or that another socket has;
	 * returns whether it was applied.
	 */
	renameCustomSocket(nodeId: string, side: SocketSide, socketId: string, label: string): boolean {
		const node = this.customNode(nodeId);
		const name = label.trim();
		if (!node || !isSocketName(name)) return false;
		const { inputs, outputs } = customSockets(node.data);
		if ([...inputs, ...outputs].some((s) => s.id !== socketId && s.label === name))
			return false;
		this.updateSockets(nodeId, side, (sockets) =>
			sockets.map((s) => (s.id === socketId ? { ...s, label: name } : s)),
		);
		return true;
	}

	/** Change a socket's type; links that no longer fit are removed. */
	setCustomSocketType(nodeId: string, side: SocketSide, socketId: string, type: WgslType) {
		this.updateSockets(nodeId, side, (sockets) =>
			sockets.map((s) => (s.id === socketId ? { ...s, type } : s)),
		);
	}

	/** Move a socket up (-1) or down (+1) among its side's. */
	moveCustomSocket(nodeId: string, side: SocketSide, socketId: string, offset: -1 | 1) {
		this.updateSockets(nodeId, side, (sockets) => {
			const index = sockets.findIndex((s) => s.id === socketId);
			const moved = [...sockets];
			const [socket] = moved.splice(index, 1);
			if (index < 0 || !socket) return sockets;
			moved.splice(Math.max(0, Math.min(moved.length, index + offset)), 0, socket);
			return moved;
		});
	}

	/** Give an Index Switch `count` cases, dropping the links and values of those removed. */
	setIndexSwitchCases(nodeId: string, count: number) {
		const node = this.activeDocument.nodesById.get(nodeId);
		if (node?.type !== INDEX_SWITCH || this.isLocked) return;
		const cases = clampCases(count);
		if (cases === indexSwitchCases(node.data)) return;
		const kept = new Set(Array.from({ length: cases }, (_, i) => caseHandle(i)));
		const removed = (handle: string) => handle.startsWith("case-") && !kept.has(handle);
		const values = Object.fromEntries(
			Object.entries(node.data.values ?? {}).filter(([handle]) => !removed(handle)),
		);
		this.patchNodeData(new Map([[node.id, { ...node.data, cases, values }]]));
		const doc = this.activeDocument;
		doc.edges = doc.edges.filter((e) => e.target !== node.id || !removed(e.targetHandle));
		indexDocument(doc);
		this.invalidateTypes([node.id]);
		this.rebuildTypeCache();
	}

	/**
	 * Give a Color Ramp `stops`, setting the colours in `colors` (by stop id),
	 * and dropping the links and colours of the stops removed. Moving stops
	 * without reordering them only changes values the shader reads.
	 */
	setColorRamp(
		nodeId: string,
		stops: readonly RampStop[],
		colors: Readonly<Record<string, InputValue>> = {},
	) {
		const node = this.resolveNode(nodeId);
		const doc = this.documentOf(nodeId);
		if (node?.type !== COLOR_RAMP || !doc) return;
		const ramp = sortedRampStops(stops);
		const kept = new Set(ramp.map((s) => s.id));
		const removed = (handle: string) => isRampStopId(handle) && !kept.has(handle);
		const values = {
			...Object.fromEntries(
				Object.entries(node.data.values ?? {}).filter(([handle]) => !removed(handle)),
			),
			...colors,
		};
		const order = (list: readonly RampStop[]) => list.map((s) => s.id).join(",");
		const reordered = order(ramp) !== order(colorRampStops(node.data));
		this.patchNodeData(new Map([[node.id, { ...node.data, ramp, values }]]));
		if (!reordered) return;
		doc.edges = doc.edges.filter((e) => e.target !== node.id || !removed(e.targetHandle));
		indexDocument(doc);
		this.invalidateTypes([node.id]);
		this.rebuildTypeCache();
	}

	private renderNode(nodeId: string): GraphNode | undefined {
		const node = this.activeDocument.nodesById.get(nodeId);
		return node?.type === RENDER_TEXTURE && !this.isLocked ? node : undefined;
	}

	/** The items of a Render Texture. */
	getRenderItems(nodeId: string): ZoneItem[] {
		const node = this.activeDocument.nodesById.get(nodeId);
		return node?.type === RENDER_TEXTURE ? renderTextureItems(node.data) : [];
	}

	/** Write a Render Texture's items, dropping links to those gone or no longer fitting. */
	private setRenderItems(node: GraphNode, items: ZoneItem[]) {
		this.patchNodeData(new Map([[node.id, { ...node.data, items }]]));
		this.invalidateTypes([node.id]);
		const ids = new Set(items.map((i) => i.id));
		const fixed = new Set([RENDER_SCALE, RENDER_PIXELS, RENDER_LIKE]);
		const doc = this.activeDocument;
		doc.edges = doc.edges.filter((e) => {
			if (e.target === node.id && !fixed.has(e.targetHandle) && !ids.has(e.targetHandle)) {
				return false;
			}
			if (e.source === node.id && !ids.has(e.sourceHandle)) return false;
			if (e.source !== node.id && e.target !== node.id) return true;
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

	/** Append an item to a Render Texture, named freely; returns it. */
	addRenderItem(
		nodeId: string,
		type: ZoneItem["type"] = "vec4f",
		format: TextureFormat = DEFAULT_RENDER_FORMAT,
	): ZoneItem | undefined {
		const node = this.renderNode(nodeId);
		if (!node) return undefined;
		const items = renderTextureItems(node.data);
		const labels = new Set(items.map((i) => i.label));
		let label = "Color";
		for (let n = 2; labels.has(label); n++) label = `Color ${String(n)}`;
		const item: ZoneItem = { id: crypto.randomUUID(), label, type, format };
		this.setRenderItems(node, [...items, item]);
		return item;
	}

	removeRenderItem(nodeId: string, itemId: string) {
		const node = this.renderNode(nodeId);
		if (!node) return;
		this.setRenderItems(
			node,
			renderTextureItems(node.data).filter((i) => i.id !== itemId),
		);
	}

	/** Rename an item; rejects empty or duplicate names, returning whether it was applied. */
	renameRenderItem(nodeId: string, itemId: string, label: string): boolean {
		const node = this.renderNode(nodeId);
		const name = label.trim();
		if (!node || !name) return false;
		const items = renderTextureItems(node.data);
		if (items.some((i) => i.id !== itemId && i.label === name)) return false;
		this.setRenderItems(
			node,
			items.map((i) => (i.id === itemId ? { ...i, label: name } : i)),
		);
		return true;
	}

	/** Change the format an item is kept in. */
	setRenderItemFormat(nodeId: string, itemId: string, format: TextureFormat) {
		const node = this.renderNode(nodeId);
		if (!node) return;
		this.setRenderItems(
			node,
			renderTextureItems(node.data).map((i) => (i.id === itemId ? { ...i, format } : i)),
		);
	}

	/** Change the type of the values an item draws; links that no longer fit are removed. */
	setRenderItemType(nodeId: string, itemId: string, type: WgslType) {
		const node = this.renderNode(nodeId);
		if (!node) return;
		this.setRenderItems(
			node,
			renderTextureItems(node.data).map((i) => (i.id === itemId ? { ...i, type } : i)),
		);
	}

	/** Move an item up (-1) or down (+1) among the node's. */
	moveRenderItem(nodeId: string, itemId: string, offset: -1 | 1) {
		const node = this.renderNode(nodeId);
		if (!node) return;
		const items = [...renderTextureItems(node.data)];
		const index = items.findIndex((i) => i.id === itemId);
		const other = items[index + offset];
		const item = items[index];
		if (!item || !other) return;
		items[index] = other;
		items[index + offset] = item;
		this.setRenderItems(node, items);
	}
}
