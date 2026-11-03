import type { Asset } from "../assets/assets";
import { PreviewModel } from "./model-preview";

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
}
