import { type Asset, type AssetKind, DEFAULT_PLAYBACK, type VideoPlayback } from "../assets/assets";
import { IMAGE, MEDIA_NODE_TYPES, VIDEO } from "../nodes/texture";
import type { GraphNode } from "./document";
import { PreviewModel } from "./model-preview";

/** The node type showing an asset of each kind. */
export const MEDIA_NODE_OF: Record<AssetKind, typeof IMAGE | typeof VIDEO> = {
	image: IMAGE,
	video: VIDEO,
};

/** The files a project uses. Only their metadata is in the model (and its history). */
export abstract class AssetModel extends PreviewModel {
	/** Replaced, never mutated. */
	get assets(): readonly Asset[] {
		return this.state.assets;
	}

	asset(id: string): Asset | undefined {
		return this.state.assets.find((a) => a.id === id);
	}

	/** The asset whose file has `hash`, if one does. */
	assetByHash(hash: string): Asset | undefined {
		return this.state.assets.find((a) => a.hash === hash);
	}

	addAsset(asset: Asset) {
		this.state.assets = [...this.state.assets, asset];
	}

	renameAsset(id: string, name: string) {
		const trimmed = name.trim();
		if (trimmed === "") return;
		this.state.assets = this.state.assets.map((a) =>
			a.id === id ? { ...a, name: trimmed } : a,
		);
	}

	/** Give an asset another file of its kind, keeping its id (so what uses it keeps it). */
	replaceAsset(asset: Asset) {
		this.state.assets = this.state.assets.map((a) => (a.id === asset.id ? asset : a));
	}

	removeAsset(id: string) {
		this.state.assets = this.state.assets.filter((a) => a.id !== id);
	}

	private usageCache: { nodes: readonly GraphNode[][]; usages: Map<string, number> } | undefined;

	/**
	 * How many nodes of the user's documents read each asset, by asset id
	 * (absent when none). Memoised on the documents' nodes.
	 */
	assetUsages(): ReadonlyMap<string, number> {
		const nodes = [...this.project.definitions]
			.filter(([ref]) => !this.isStandardLibrary(ref))
			.map(([, doc]) => doc.nodes);
		const cached = this.usageCache;
		if (cached?.nodes.length === nodes.length && cached.nodes.every((n, i) => n === nodes[i])) {
			return cached.usages;
		}
		const usages = new Map<string, number>();
		for (const node of nodes.flat()) {
			const asset = node.data.asset;
			if (asset !== undefined) usages.set(asset, (usages.get(asset) ?? 0) + 1);
		}
		this.usageCache = { nodes, usages };
		return usages;
	}

	/** Have an Image or Video node read an asset of its kind (or none, with `undefined`). */
	setNodeAsset(nodeId: string, assetId: string | undefined) {
		const node = this.resolveNode(nodeId);
		const asset = assetId === undefined ? undefined : this.asset(assetId);
		if (!node || !MEDIA_NODE_TYPES.has(node.type)) return;
		if (asset && MEDIA_NODE_OF[asset.kind] !== node.type) return;
		this.updateNodeData(nodeId, { asset: asset?.id }, { retype: false });
	}

	/** Change how a Video node plays its asset. */
	setVideoPlayback(nodeId: string, playback: Partial<VideoPlayback>) {
		const node = this.resolveNode(nodeId);
		if (node?.type !== VIDEO) return;
		const current = node.data.playback ?? DEFAULT_PLAYBACK;
		this.updateNodeData(nodeId, { playback: { ...current, ...playback } }, { retype: false });
	}

	/**
	 * Whether a node reads an asset whose file isn't there (`hasFile` tells
	 * which are): it reads a transparent image instead.
	 */
	missingAsset(nodeId: string, hasFile: (assetId: string) => boolean): boolean {
		const asset = this.resolveNode(nodeId)?.data.asset;
		return asset !== undefined && (!this.asset(asset) || !hasFile(asset));
	}
}
