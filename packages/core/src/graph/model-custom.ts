import {
	CUSTOM_WGSL,
	type CustomSockets,
	type SocketSide,
	customSockets,
	isSocketName,
	newSocketLabel,
} from "../nodes/custom";
import type { HandleDef, WgslType } from "../types";
import type { GraphNode } from "./document";
import { indexDocument } from "./hydrate";
import { GroupModel } from "./model-groups";

/** Editing Custom WGSL nodes: their code and their sockets. */
export abstract class CustomWgslModel extends GroupModel {
	private customNode(nodeId: string): GraphNode | undefined {
		const node = this.activeDocument.nodesById.get(nodeId);
		return node?.type === CUSTOM_WGSL && !this.isLocked ? node : undefined;
	}

	setCustomCode(nodeId: string, code: string) {
		if (!this.customNode(nodeId)) return;
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
}
