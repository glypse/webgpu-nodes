import {
	type FrameCompiler,
	type FrameDependencies,
	frameDependencies,
	type FrameProgram,
	type FrameRef,
} from "../frame/program";
import { loopId } from "../passes/loop";
import type { TextureSources } from "../passes/sources";
import type { FrameArg, TextureSize } from "../passes/textures";

type Cache = { program: FrameProgram; byStep: Map<number, FrameDependencies> };

const caches = new WeakMap<FrameCompiler, Cache>();

/**
 * What a frame value depends on, memoised by step: steps are only ever
 * appended, so a snapshot of the program serves every value it contains and
 * is taken again only for a newer one.
 */
export function frameValueDependencies(frame: FrameCompiler, ref: FrameRef): FrameDependencies {
	let cache = caches.get(frame);
	if (!cache || ref.step >= cache.program.steps.length) {
		cache = { program: frame.program(), byStep: new Map() };
		caches.set(frame, cache);
	}
	let found = cache.byStep.get(ref.step);
	if (!found) {
		found = frameDependencies(cache.program, [ref]);
		cache.byStep.set(ref.step, found);
	}
	return found;
}

const stabilities = new WeakMap<TextureSources, { frame?: FrameCompiler; value: SizeStability }>();

/** The stability analysis of a graph state's sources, shared by the shaders of one plan. */
export function sizeStability(sources: TextureSources, frame?: FrameCompiler): SizeStability {
	const known = stabilities.get(sources);
	if (known && known.frame === frame) return known.value;
	const value = new SizeStability(sources, frame);
	stabilities.set(sources, { ...(frame ? { frame } : {}), value });
	return value;
}

/**
 * Whether the size of a loop's item is the same in every iteration of that
 * loop. Passes of an iteration read the item as drawn by the previous
 * one, so a texel can be read at the same position only if both have the
 * size.
 */
export class SizeStability {
	private memo = new WeakMap<TextureSize, Map<string, boolean>>();

	constructor(
		private sources: TextureSources,
		private frame?: FrameCompiler,
	) {}

	/**
	 * Whether `size` can't vary between the iterations of `loop`: it reads neither the
	 * iteration of the loop nor a texture of it, directly or through the sizes of
	 * the resources it's made of. Unsure is not stable.
	 */
	stable(loop: string, size: TextureSize): boolean {
		let byLoop = this.memo.get(size);
		if (!byLoop) {
			byLoop = new Map();
			this.memo.set(size, byLoop);
		}
		let result = byLoop.get(loop);
		if (result === undefined) {
			result = this.sizeStable(loop, size, new Set());
			byLoop.set(loop, result);
		}
		return result;
	}

	private sizeStable(loop: string, size: TextureSize, visiting: Set<string>): boolean {
		if (size.kind === "pixels") {
			return (
				this.argStable(loop, size.width, visiting) &&
				this.argStable(loop, size.height, visiting)
			);
		}
		if (!this.argStable(loop, size.scale, visiting)) return false;
		return size.of === "canvas" || this.resourceStable(loop, size.of.resource, visiting);
	}

	private argStable(loop: string, arg: FrameArg, visiting: Set<string>): boolean {
		if (typeof arg === "number") return true;
		if (!this.frame) return false;
		const needs = frameValueDependencies(this.frame, arg.frame);
		if (needs.loops.has(loop)) return false;
		for (const id of needs.textures) if (!this.resourceStable(loop, id, visiting)) return false;
		return true;
	}

	private resourceStable(loop: string, id: string, visiting: Set<string>): boolean {
		// Reached again through itself: the cycle adds nothing the first visit doesn't see.
		if (visiting.has(id)) return true;
		const source = this.sources.byId(id);
		if (!source) return false;
		visiting.add(id);
		try {
			switch (source.kind) {
				case "loop":
					return (
						loopId(source.loop) !== loop && this.sizeStable(loop, source.size, visiting)
					);
				case "render":
				case "state":
					return this.sizeStable(loop, source.size, visiting);
				default:
					return true;
			}
		} finally {
			visiting.delete(id);
		}
	}
}
