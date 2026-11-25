import {
	type ColorSpace,
	evaluateFrame,
	type FrameArg,
	type FrameEnv,
	type FrameProgram,
	type FrameRef,
	type FrameValues,
	type LoopDecl,
	type LoopItem,
	mipLevelCount,
	type PassDecl,
	PLAN_TARGET,
	type PlanNode,
	type RenderPlan,
	resolveSize,
	type ResourceDecl,
	type TextureFormat,
	type TextureSize,
	type UniformValue,
} from "$core";

import { clampIterations, type DependencyCache, ScopedMemo } from "./loops";
import type { TextureOf } from "./media";
import type { CompiledProgram, Draw } from "./program";
import type { FrameInputs, Size } from "./renderer";
import type { SimulationState, Step } from "./simulation";
import type { TexturePool } from "./texture-pool";

/** A recorded pass, and the textures it drew that need their mip levels made after it. */
export type Walked = { draw: Draw; mips: GPUTexture[] };

export type WalkInput = {
	plan: RenderPlan;
	resources: ReadonlyMap<string, ResourceDecl>;
	frameProgram: FrameProgram;
	uniforms: Readonly<Record<string, UniformValue>>;
	dependencies: DependencyCache;
	frame: FrameInputs;
	colorSpace: ColorSpace;
	/** The texture the frame is drawn into. */
	target: GPUTexture;
	maxDimension: number;
	/** The format of a texture no resource says the format of. */
	defaultFormat: TextureFormat;
	programOf: (decl: PassDecl) => CompiledProgram;
	mediaOf: TextureOf;
	mediaSize: (id: string) => Size | undefined;
	emptyTexture: GPUTexture;
	state: SimulationState;
	/** A pass's own texture outside loops, kept while its size and format stay the same. */
	persistent: (id: string, size: Size, format: TextureFormat, mips: boolean) => GPUTexture;
	pool: TexturePool<GPUTexture>;
};

/** An item of a loop being run: the two textures keeping it. */
type ItemRun = { item: LoopItem; current?: GPUTexture; next?: GPUTexture };

type Sized = { size: Size; dependent: boolean };

/**
 * Walks a plan's tree for one encode, recording the draws in order: a loop
 * draws its start, then for each iteration its body and next passes, and
 * swaps the textures of its items after all the next passes.
 *
 * What a loop's passes need only for an iteration (their own textures) is
 * borrowed from the pool and given back as it ends, so iterations of
 * different sizes share textures, and nothing a recorded draw uses is
 * destroyed while the command buffer is being encoded.
 */
export class PlanWalk {
	private canvas: Size;
	private drawn: Walked[] = [];
	private steps: ReadonlyMap<string, Step> = new Map();
	private sizes = new ScopedMemo<Sized>();
	/** Set while resolving something that depends on the iteration of a loop. */
	private dependent = false;
	private resolving = new Set<string>();
	/** The iteration each loop being run is at. */
	private iteration = new Map<string, number>();
	private active = new Map<string, Map<string, ItemRun>>();
	/** The items loops ended as, by texture pair. */
	private finals = new Map<string, GPUTexture>();
	/** The textures of passes in each iteration being run, by resource. */
	private scoped: Map<string, GPUTexture>[] = [];
	/** Textures to give back to the pool: those of each iteration being run, and the walk's own. */
	private borrowed: GPUTexture[][] = [[]];
	/** Values of passes that don't depend on an iteration, by pass and size. */
	private passValues = new Map<string, FrameValues>();

	constructor(private input: WalkInput) {
		this.canvas = { width: input.target.width, height: input.target.height };
	}

	/** Values from the frame program as the walk is. */
	evaluate(passSize: Size): FrameValues {
		const { frame } = this.input;
		return evaluateFrame(this.input.frameProgram, {
			time: frame.time,
			delta: frame.delta,
			frame: frame.frame,
			canvas: this.canvas,
			passSize,
			iteration: (id) => this.iteration.get(id),
			textureSize: (id) => this.textureSize(id),
			uniforms: this.input.uniforms,
		} satisfies FrameEnv);
	}

	/** Record the draws of the plan. */
	run(): Walked[] {
		try {
			const { plan, state, frame } = this.input;
			// State is sized by frame values too, so it's kept once sizes can be resolved.
			this.steps = state.advance(plan, frame, (id) => this.sizeOf(id) ?? this.canvas);
			// Every size outside loops is known before any pass is recorded, so frame values can read them.
			for (const node of plan.passes) {
				if (node.kind === "render") for (const id of node.writes) this.sizeOf(id);
			}
			this.runNodes(plan.passes);
			return this.drawn;
		} finally {
			for (const texture of this.borrowed.flat()) this.input.pool.release(texture);
			this.borrowed = [[]];
			this.input.pool.trim();
		}
	}

	private runNodes(nodes: readonly PlanNode[]) {
		for (const node of nodes) {
			if (node.kind === "loop") this.runLoop(node);
			else this.runPass(node);
		}
	}

	private runPass(decl: PassDecl) {
		const simulation = decl.simulation;
		// A simulation's start only draws on the frames it starts.
		if (simulation?.stage === "start" && this.steps.get(simulation.id)?.kind !== "start")
			return;
		const { frame, colorSpace } = this.input;
		const targets = decl.writes.map((id) => this.written(id));
		const step = simulation && this.steps.get(simulation.id);
		const draw = this.input.programOf(decl).record(targets, frame, colorSpace, this.textureOf, {
			simulationDelta: step?.delta ?? 0,
			frameValuesOf: (passSize) => this.valuesOf(decl, passSize),
		});
		this.drawn.push({ draw, mips: targets.filter((t) => t.mipLevelCount > 1) });
	}

	private valuesOf(decl: PassDecl, passSize: Size): FrameValues {
		const fields = () => Object.values(decl.program.frameValues.fields).map((f) => f.ref);
		const dependent = this.dependsOnIteration(decl.id, fields);
		const key = `${decl.id}|${String(passSize.width)}x${String(passSize.height)}`;
		if (!dependent) {
			const known = this.passValues.get(key);
			if (known) return known;
		}
		const values = this.evaluate(passSize);
		if (!dependent) this.passValues.set(key, values);
		return values;
	}

	private runLoop(decl: LoopDecl) {
		if (this.active.has(decl.id)) throw new Error(`The loop "${decl.id}" runs inside itself.`);
		const count = clampIterations(this.argOf(decl.iterations), decl.max);
		const items = new Map<string, ItemRun>(decl.items.map((item) => [item.texture, { item }]));
		this.active.set(decl.id, items);
		let done = false;
		try {
			// The initial values are as big as the first iteration says.
			for (const entry of items.values()) {
				entry.current = this.withIteration(decl.id, 0, () =>
					this.itemTexture(this.sizeAt(entry.item.size), entry.item.format),
				);
			}
			this.runNodes(decl.start);
			for (let iteration = 0; iteration < count; iteration++) {
				this.iterate(decl, items, iteration);
			}
			// What the loop ends as belongs to where it ran, so it's read until that ends.
			for (const [texture, entry] of items) {
				if (entry.next) this.input.pool.release(entry.next);
				if (!entry.current) continue;
				this.finals.set(texture, entry.current);
				this.borrowed.at(-1)?.push(entry.current);
			}
			done = true;
		} finally {
			this.active.delete(decl.id);
			if (!done) {
				for (const { current, next } of items.values()) {
					if (current) this.input.pool.release(current);
					if (next) this.input.pool.release(next);
				}
			}
		}
	}

	private iterate(decl: LoopDecl, items: Map<string, ItemRun>, iteration: number) {
		this.iteration.set(decl.id, iteration);
		this.sizes.push();
		this.scoped.push(new Map());
		this.borrowed.push([]);
		try {
			for (const entry of items.values()) {
				const { item } = entry;
				const size = this.sizeAt(item.size);
				const next = entry.next;
				if (
					next?.width === size.width &&
					next.height === size.height &&
					next.format === item.format
				) {
					continue;
				}
				if (next) this.input.pool.release(next);
				entry.next = this.itemTexture(size, item.format);
			}
			this.runNodes(decl.body);
			this.runNodes(decl.next);
			// Every next pass has read the current values, so they can be replaced.
			for (const entry of items.values()) {
				[entry.current, entry.next] = [entry.next, entry.current];
			}
		} finally {
			this.sizes.pop();
			this.scoped.pop();
			for (const texture of this.borrowed.pop() ?? []) this.input.pool.release(texture);
			this.iteration.delete(decl.id);
		}
	}

	/** Run `compute` as the loop is at `iteration`, for what depends on it. */
	private withIteration<T>(loop: string, iteration: number, compute: () => T): T {
		this.iteration.set(loop, iteration);
		this.sizes.push();
		try {
			return compute();
		} finally {
			this.sizes.pop();
			this.iteration.delete(loop);
		}
	}

	/** A texture keeping a loop item, which the loop gives back itself as items are swapped. */
	private itemTexture(size: Size, format: TextureFormat): GPUTexture {
		return this.input.pool.acquire({ ...size, format, levels: 1 });
	}

	/** A texture for the iteration being run, given back when it ends. */
	private borrow(size: Size, format: TextureFormat, levels: number): GPUTexture {
		const texture = this.input.pool.acquire({ ...size, format, levels });
		this.borrowed.at(-1)?.push(texture);
		return texture;
	}

	private argOf(arg: FrameArg): number {
		return typeof arg === "number" ? arg : this.evaluate(this.canvas).arg(arg);
	}

	/** Whether the values of `refs` can differ from one iteration to the next. */
	private dependsOnIteration(key: string, refs: () => Iterable<FrameRef>): boolean {
		const found = this.input.dependencies.of(key, refs);
		if (found.loops.size > 0) return true;
		const outer = this.dependent;
		this.dependent = false;
		for (const id of found.textures) this.sizeOf(id);
		const result = this.dependent;
		this.dependent = outer;
		return result;
	}

	private sizeAt(size: TextureSize): Size {
		return resolveSize(size, {
			canvas: this.canvas,
			resource: (id) => this.sizeOf(id),
			maxDimension: this.input.maxDimension,
			frame: (ref) => {
				const key = `size:${String(ref.step)}:${ref.output}:${String(ref.component)}`;
				if (this.dependsOnIteration(key, () => [ref])) this.dependent = true;
				return this.evaluate(this.canvas).arg({ frame: ref });
			},
		});
	}

	/** The size of a resource now, which a size that depends on an iteration changes. */
	private sizeOf(id: string): Size | undefined {
		const known = this.sizes.get(id);
		if (known) {
			if (known.dependent) this.dependent = true;
			return known.size;
		}
		const resource = this.input.resources.get(id);
		if (resource?.kind === "media") return this.input.mediaSize(id);
		if (resource?.kind === "loop") {
			this.dependent = true;
			return this.loopSize(resource);
		}
		if (resource?.kind !== "transient" && resource?.kind !== "state") return undefined;
		// A size that depends on itself has nothing to start from.
		if (this.resolving.has(id)) return this.canvas;
		this.resolving.add(id);
		const outer = this.dependent;
		this.dependent = false;
		let size: Size;
		try {
			size = this.sizeAt(resource.size);
		} finally {
			this.resolving.delete(id);
		}
		const own = this.dependent;
		this.dependent = outer || own;
		this.sizes.set(id, { size, dependent: own }, own);
		return size;
	}

	/** A loop item's size as the textures keeping it are: what's read is what was drawn. */
	private loopSize(resource: ResourceDecl & { kind: "loop" }): Size | undefined {
		const texture = this.loopTexture(resource);
		return texture && { width: texture.width, height: texture.height };
	}

	private textureSize(id: string) {
		// Reading a size for a frame value says nothing of what the one reading depends on.
		const outer = this.dependent;
		const size = this.sizeOf(id);
		this.dependent = outer;
		if (!size) return undefined;
		const resource = this.input.resources.get(id);
		return {
			...size,
			levels: resource?.kind === "transient" && resource.mips ? mipLevelCount(size) : 1,
		};
	}

	private loopTexture(resource: ResourceDecl & { kind: "loop" }): GPUTexture | undefined {
		return resource.read === "final"
			? this.finals.get(resource.texture)
			: this.active.get(resource.loop)?.get(resource.texture)?.[resource.read];
	}

	private transient(id: string, writing: boolean): GPUTexture {
		const scopes = writing ? this.scoped.slice(-1) : this.scoped.toReversed();
		for (const scope of scopes) {
			const found = scope.get(id);
			if (found) return found;
		}
		const resource = this.input.resources.get(id);
		const size = this.sizeOf(id) ?? this.canvas;
		const format = resource?.kind === "transient" ? resource.format : this.input.defaultFormat;
		const mips = resource?.kind === "transient" && resource.mips === true;
		const innermost = this.scoped.at(-1);
		// What's read and isn't made in an iteration was made outside the loops.
		if (!innermost || !writing) return this.input.persistent(id, size, format, mips);
		const texture = this.borrow(size, format, mips ? mipLevelCount(size) : 1);
		innermost.set(id, texture);
		return texture;
	}

	private stateTexture(texture: string, read: "previous" | "current"): GPUTexture {
		return this.input.state.texture(texture, read) ?? this.input.emptyTexture;
	}

	private written(id: string): GPUTexture {
		if (id === PLAN_TARGET) return this.input.target;
		const resource = this.input.resources.get(id);
		if (resource?.kind === "state") return this.stateTexture(resource.texture, resource.read);
		if (resource?.kind === "loop") {
			const texture = this.loopTexture(resource);
			if (!texture) throw new Error(`The loop item "${id}" is written outside its loop.`);
			return texture;
		}
		return this.transient(id, true);
	}

	private textureOf: TextureOf = (source) => {
		switch (source.kind) {
			case "render":
				return this.transient(source.id, false);
			case "state":
				return this.stateTexture(source.texture, source.read);
			case "loop": {
				const resource = this.input.resources.get(source.id);
				return (
					(resource?.kind === "loop" ? this.loopTexture(resource) : undefined) ??
					this.input.emptyTexture
				);
			}
			default:
				return this.input.mediaOf(source);
		}
	};
}
