export type TextureSpec = { width: number; height: number; format: string; levels: number };

const keyOf = ({ width, height, format, levels }: TextureSpec) =>
	`${String(width)}x${String(height)}:${format}:${String(levels)}`;

/**
 * Textures kept by size, format and mip levels, so passes that need a
 * texture only for a while (the iterations of a loop) borrow one instead of
 * making it. Within a command buffer a released texture can be acquired
 * again at once, as passes run in the order they were encoded.
 */
export class TexturePool<T extends { destroy(): void }> {
	private free = new Map<string, T[]>();
	private keys = new Map<T, string>();
	private inUse = new Set<T>();
	private touched = new Set<T>();

	constructor(private create: (spec: TextureSpec) => T) {}

	acquire(spec: TextureSpec): T {
		const key = keyOf(spec);
		const texture = this.free.get(key)?.pop() ?? this.create(spec);
		this.keys.set(texture, key);
		this.inUse.add(texture);
		this.touched.add(texture);
		return texture;
	}

	release(texture: T) {
		const key = this.keys.get(texture);
		if (key === undefined || !this.inUse.delete(texture)) {
			throw new Error("A texture was released that isn't borrowed.");
		}
		const list = this.free.get(key);
		if (list) list.push(texture);
		else this.free.set(key, [texture]);
	}

	/** The textures borrowed and not released. */
	get borrowed(): number {
		return this.inUse.size;
	}

	/** The textures kept, borrowed or not. */
	get size(): number {
		return this.keys.size;
	}

	/**
	 * Drop what the encode just finished didn't use. Those can only be read by
	 * earlier command buffers, which keep what they use alive; the ones it used
	 * may be in the command buffer being encoded.
	 */
	trim() {
		for (const [key, list] of this.free) {
			const kept = list.filter((t) => this.touched.has(t));
			for (const texture of list) {
				if (this.touched.has(texture)) continue;
				texture.destroy();
				this.keys.delete(texture);
			}
			if (kept.length > 0) this.free.set(key, kept);
			else this.free.delete(key);
		}
		this.touched.clear();
	}

	destroy() {
		for (const texture of this.keys.keys()) texture.destroy();
		this.free.clear();
		this.keys.clear();
		this.inUse.clear();
		this.touched.clear();
	}
}
