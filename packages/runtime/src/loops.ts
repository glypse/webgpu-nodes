import { type FrameDependencies, frameDependencies, type FrameProgram, type FrameRef } from "$core";

/** An iteration count as the loop runs it: whole, and between none and `max`. */
export function clampIterations(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Math.max(0, Math.trunc(value)), max);
}

/**
 * Values kept for the encode of a frame, some of which depend on the
 * iteration of a loop. Those are kept in the scope of the iteration, which
 * ends with it; the others are kept for the whole encode.
 */
export class ScopedMemo<V> {
	private base = new Map<string, V>();
	private scopes: Map<string, V>[] = [];

	push() {
		this.scopes.push(new Map());
	}

	pop() {
		this.scopes.pop();
	}

	get(key: string): V | undefined {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const value = this.scopes[i]?.get(key);
			if (value !== undefined) return value;
		}
		return this.base.get(key);
	}

	/** Outside any scope a value that depends on the iteration is no one's to keep. */
	set(key: string, value: V, dependent: boolean) {
		const scope = this.scopes.at(-1);
		if (dependent) scope?.set(key, value);
		else this.base.set(key, value);
	}
}

/** What sets of a frame program's values depend on, found once for each. */
export class DependencyCache {
	private known = new Map<string, FrameDependencies>();

	constructor(private program: FrameProgram) {}

	of(key: string, refs: () => Iterable<FrameRef>): FrameDependencies {
		let found = this.known.get(key);
		if (!found) {
			found = frameDependencies(this.program, refs());
			this.known.set(key, found);
		}
		return found;
	}
}
