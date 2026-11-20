import { type Asset, assetFile, assetHash, assetKindOf, assetName } from "$core";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { SvelteMap } from "svelte/reactivity";

/** Enough packets for a good estimate without reading a whole file. */
const PACKETS_FOR_FRAME_RATE = 600;

async function probeVideo(file: Blob) {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("The file has no video track.");
		return {
			width: await track.getDisplayWidth(),
			height: await track.getDisplayHeight(),
			duration: await input.computeDuration(),
			frameRate: (await track.computePacketStats(PACKETS_FOR_FRAME_RATE)).averagePacketRate,
		};
	} finally {
		input.dispose();
	}
}

async function probeImage(file: Blob) {
	const bitmap = await createImageBitmap(file);
	const size = { width: bitmap.width, height: bitmap.height };
	bitmap.close();
	return size;
}

/**
 * Describe a file as an asset with id `id`; undefined when it isn't media
 * the editor can use (or it can't be read).
 */
export async function describeAsset(file: File, id: string): Promise<Asset | undefined> {
	const kind = assetKindOf(file.type);
	if (!kind) return undefined;
	const common = {
		id,
		name: assetName(file.name),
		file: assetFile(kind, id, file.name),
		mime: file.type,
		bytes: file.size,
		hash: await assetHash(await file.arrayBuffer()),
	};
	try {
		return kind === "image"
			? { kind, ...common, ...(await probeImage(file)) }
			: { kind, ...common, ...(await probeVideo(file)) };
	} catch (err) {
		console.error(`[assets] can't read ${file.name}`, err);
		return undefined;
	}
}

/**
 * The files of a project's assets, by asset id, outside the model and its
 * history: an asset removed then brought back by undo finds its file here.
 */
export class AssetFiles {
	private files = new SvelteMap<string, Blob>();
	private urls = new Map<string, string>();

	get(id: string): Blob | undefined {
		return this.files.get(id);
	}

	set(id: string, file: Blob) {
		this.revoke(id);
		this.files.set(id, file);
	}

	/** An object URL of an asset's file, e.g. for a thumbnail; the same one until it changes. */
	url(id: string): string | undefined {
		const file = this.files.get(id);
		if (!file) return undefined;
		let url = this.urls.get(id);
		if (!url) {
			url = URL.createObjectURL(file);
			this.urls.set(id, url);
		}
		return url;
	}

	/** Replace every file, e.g. with a loaded project's. */
	reset(files: Iterable<[string, Blob]>) {
		for (const id of [...this.urls.keys()]) this.revoke(id);
		this.files.clear();
		for (const [id, file] of files) this.files.set(id, file);
	}

	private revoke(id: string) {
		const url = this.urls.get(id);
		if (url) URL.revokeObjectURL(url);
		this.urls.delete(id);
	}
}
