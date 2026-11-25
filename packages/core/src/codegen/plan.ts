import type { VideoPlayback } from "../assets/assets";
import { FrameValueAnalysis } from "../frame/analysis";
import {
	FrameCompiler,
	frameDependencies,
	type FrameProgram,
	type FrameRef,
} from "../frame/program";
import { loopId, type LoopRead, loopReadId, type LoopRef } from "../passes/loop";
import {
	attachmentGroups,
	simulationId,
	type SimulationRef,
	type StateItem,
	type StateRead,
	stateReadId,
} from "../passes/simulation";
import { loopSource, stateSource, type TextureSource, TextureSources } from "../passes/sources";
import {
	CANVAS_SIZE,
	type FrameArg,
	type TextureFormat,
	type TextureSize,
} from "../passes/textures";
import { DEFAULT_ITERATIONS, ITERATIONS_HANDLE, zoneMaxIterations } from "../zones";
import {
	type CodegenGraph,
	generateShader,
	type ShaderOptions,
	type ShaderTarget,
	type SimulationStage,
} from "./generate";
import type { UniformValue } from "./literals";
import { buildProgram, type ShaderProgram } from "./program";

/** What the last pass of a plan writes: the frame drawn. */
export const PLAN_TARGET = "target";

/** A texture a plan reads or writes. Open to more kinds: buffers (compute). */
export type ResourceDecl =
	/** Written by a pass, then read. */
	| {
			id: string;
			kind: "transient";
			size: TextureSize;
			format: TextureFormat;
			/** Whether it has a full chain of mip levels, made after its pass. */
			mips?: true;
	  }
	/** A video's `time`, if it has one: the project time it shows, else the frame's. */
	| { id: string; kind: "media"; asset: string; video?: VideoPlayback; time?: FrameArg }
	/**
	 * A simulation's state item, as of the previous frame or this one: one of
	 * the two textures keeping it (`texture`), which swap roles as frames go
	 * by. The simulation starts over when the size they resolve to changes.
	 */
	| {
			id: string;
			kind: "state";
			texture: string;
			read: StateRead;
			format: TextureFormat;
			size: TextureSize;
			/** The simulation it's state of, by `simulationId`. */
			simulation: string;
	  }
	/**
	 * A Repeat Passes item, one of the two textures keeping it (`texture`)
	 * as read in `read`'s moment: `current` is written by the loop's `start`
	 * and the iterations' swaps, `next` by `next` passes, and `final` is
	 * what `current` is when the loop ends, which is the initial value when
	 * it has no iterations. The textures swap roles after each iteration.
	 */
	| {
			id: string;
			kind: "loop";
			texture: string;
			read: LoopRead;
			format: TextureFormat;
			/** Resolved with the iteration of the pass writing it, 0 for `start` passes. */
			size: TextureSize;
			/** The loop it's an item of. */
			loop: string;
	  }
	| { id: string; kind: "empty" };

/** A program drawing into textures (`writes`, or the frame for `PLAN_TARGET`). */
export type PassDecl = {
	id: string;
	kind: "render";
	program: ShaderProgram;
	/** The resources the program reads, by id. */
	reads: string[];
	/** The resources it draws into, a colour attachment each, in the program's order. */
	writes: string[];
	/**
	 * The simulation it computes something of, by `simulationId`, reading
	 * the seconds since its previous step. A start pass draws its initial
	 * state, only on the frames it starts.
	 */
	simulation?: { id: string; stage?: SimulationStage };
};

/** An item of a loop, kept in the textures of its `loop` resources. */
export type LoopItem = {
	id: string;
	/** The texture pair keeping it (see `loopTextureId`). */
	texture: string;
	format: TextureFormat;
	/** Resolved for each iteration: a pass writing the item's `next` is at that iteration. */
	size: TextureSize;
};

/**
 * Passes repeated by a Repeat Passes zone. Its `iterations` (clamped to
 * `max`) are evaluated once the loop is reached; then `start` draws the
 * items' initial values, and each iteration draws `body` then `next`, which
 * writes the items' next values, and swaps each item's pair. Loops nest in
 * a `body`.
 */
export type LoopDecl = {
	id: string;
	kind: "loop";
	iterations: FrameArg;
	max: number;
	items: LoopItem[];
	start: PlanNode[];
	body: PlanNode[];
	next: PlanNode[];
};

/** What a plan runs in order: a pass, or a loop of passes. */
export type PlanNode = PassDecl | LoopDecl;

/** The passes of `nodes` in the order they run: a loop's start, then its body, then its next. */
export function planPasses(nodes: readonly PlanNode[]): PassDecl[] {
	return nodes.flatMap((node) =>
		node.kind === "loop"
			? [...planPasses(node.start), ...planPasses(node.body), ...planPasses(node.next)]
			: [node],
	);
}

/** The loops of `nodes`, those nested in them after them. */
export function planLoops(nodes: readonly PlanNode[]): LoopDecl[] {
	return nodes.flatMap((node) =>
		node.kind === "loop"
			? [node, ...planLoops(node.start), ...planLoops(node.body), ...planLoops(node.next)]
			: [],
	);
}

/**
 * How a frame is drawn: passes in order, each reading the textures earlier
 * ones wrote (or, for a simulation's state, the previous frame's), the last
 * drawing the frame. Besides the last, passes render values linked to
 * Texture inputs, and compute simulations' state. Repeat Passes zones are
 * loops of passes: a pass is in the body of the innermost loop whose items
 * or iteration it reads, directly or through other passes, and before all
 * loops otherwise.
 */
export type RenderPlan = {
	resources: ResourceDecl[];
	passes: PlanNode[];
	/** The uniform values of every pass: each program's block holds those it reads. */
	uniforms: Record<string, UniformValue>;
	/** The frame values the passes' programs read, computed on the CPU for each pass. */
	frame: FrameProgram;
};

function resourceOf(source: TextureSource): ResourceDecl {
	switch (source.kind) {
		case "render":
			return {
				id: source.id,
				kind: "transient",
				size: source.size,
				format: source.format,
				...(source.mips ? { mips: true as const } : {}),
			};
		case "media":
			return {
				id: source.id,
				kind: "media",
				asset: source.asset,
				...(source.video ? { video: source.video } : {}),
				...(source.time === undefined ? {} : { time: source.time }),
			};
		case "state":
			return {
				id: source.id,
				kind: "state",
				texture: source.texture,
				read: source.read,
				format: source.format,
				size: source.size,
				simulation: simulationId(source.simulation),
			};
		case "loop":
			return {
				id: source.id,
				kind: "loop",
				texture: source.texture,
				read: source.read,
				format: source.format,
				size: source.size,
				loop: loopId(source.loop),
			};
		case "empty":
			return { id: source.id, kind: "empty" };
	}
}

/**
 * The passes drawing the graph: the fragment output's, after those of the
 * values it reads rendered to textures and of the simulations whose state
 * it reads, and of what those read, each once however many read it. A
 * simulation's state is drawn by a start and a step pass per run of items
 * a pass can write.
 *
 * A Repeat Passes zone is a loop whose `start` and `next` passes are those
 * of its items, as a simulation's. What they read is in the loop's body
 * if it reads an item's current value or the iteration, directly or through
 * other passes (see `LoopDecl`), and before the loop otherwise, in the
 * body of the outermost loop it's valid in.
 */
export function generateRenderPlan(
	graph: CodegenGraph,
	options: Omit<ShaderOptions, "target" | "sources"> = {},
): RenderPlan {
	const sources = new TextureSources(graph);
	const frame = new FrameCompiler(graph, new FrameValueAnalysis(graph, sources), sources, {
		uniformScopes: new Set(options.uniformScopes ?? []),
	});
	const top: PlanNode[] = [];
	const resources = new Map<string, ResourceDecl>();
	const uniforms: Record<string, UniformValue> = {};
	/** The loops the passes drawing each pass key are inside of. */
	const visited = new Map<string, ReadonlySet<string>>();
	/** The loops each texture made by a pass is inside of, by resource id. */
	const insideOfResource = new Map<string, ReadonlySet<string>>();
	type Loop = {
		decl: LoopDecl;
		/** Loops found later are inside the ones found before them they depend on. */
		rank: number;
		/** The loops it's inside of, once built. */
		inside?: ReadonlySet<string>;
	};
	const loops = new Map<string, Loop>();

	/** The list a pass or loop inside `inside` is in: the body of the innermost of them. */
	const containerOf = (inside: ReadonlySet<string>): PlanNode[] => {
		let innermost: Loop | undefined;
		for (const id of inside) {
			const loop = loops.get(id);
			if (loop && (!innermost || loop.rank > innermost.rank)) innermost = loop;
		}
		return innermost ? innermost.decl.body : top;
	};

	/** The loops a frame value depends on the iteration of, or the texture sizes of. */
	const argLoops = (arg: FrameArg | undefined, into: Set<string>) => {
		if (typeof arg !== "object") return;
		refLoops([arg.frame], into);
	};
	const refLoops = (refs: readonly FrameRef[], into: Set<string>) => {
		const needs = frameDependencies(frame.program(), refs);
		for (const id of needs.loops) into.add(id);
		const sized = frame.sizedTextures();
		for (const id of needs.textures) {
			const source = sized.find((t) => t.id === id);
			if (source) for (const loop of insideOfSource(source)) into.add(loop);
		}
	};
	const sizeLoops = (size: TextureSize, into: Set<string>) => {
		if (size.kind === "pixels") {
			argLoops(size.width, into);
			argLoops(size.height, into);
			return;
		}
		argLoops(size.scale, into);
		if (size.of !== "canvas") {
			for (const loop of insideOfResource.get(size.of.resource) ?? []) into.add(loop);
		}
	};
	/** The loops a pass reading `source` is inside of. */
	const insideOfSource = (source: TextureSource): ReadonlySet<string> => {
		const inside = new Set<string>();
		switch (source.kind) {
			case "loop": {
				const id = loopId(source.loop);
				if (source.read === "final") {
					for (const loop of loops.get(id)?.inside ?? []) inside.add(loop);
				} else {
					inside.add(id);
				}
				break;
			}
			case "media":
				argLoops(source.time, inside);
				break;
			case "render":
				for (const loop of insideOfResource.get(source.id) ?? []) inside.add(loop);
				sizeLoops(source.size, inside);
				break;
			case "state":
				sizeLoops(source.size, inside);
				break;
			case "empty":
				break;
		}
		return inside;
	};

	/** The run of a simulation's items, in its passes, holding `texture`'s. */
	const runOf = (ref: SimulationRef, texture: string): StateItem[] | undefined => {
		const state = sources.simulation(ref.path, ref.zone);
		return attachmentGroups(state?.items ?? []).find((run) =>
			run.some((i) => i.texture === texture),
		);
	};

	/** Declares a texture a pass reads, and adds the passes making it before the one reading it. */
	const include = (source: TextureSource) => {
		resources.set(source.id, resourceOf(source));
		if (source.kind === "render") {
			const draw = source.draw;
			if (draw) {
				visit(
					`textures:${draw.run.map((i) => i.id).join(",")}`,
					draw.run.map((i) => i.id),
					{ renderTexture: { path: draw.path, node: draw.node, items: draw.run } },
					undefined,
					source.size,
					draw.like,
				);
				for (const item of draw.run) {
					resources.set(item.id, {
						id: item.id,
						kind: "transient",
						size: source.size,
						format: item.format,
						...(source.mips ? { mips: true as const } : {}),
					});
				}
			} else {
				visit(source.id, [source.id], source.target, undefined, source.size);
			}
		}
		if (source.kind === "state") {
			const items = runOf(source.simulation, source.texture);
			if (items) {
				// What's read as the previous frame's state is the last frame's step, so
				// it has to be stepped every frame, read as its current state or not.
				if (source.read === "previous") visitSimulation(source.simulation, "start", items);
				visitSimulation(source.simulation, "step", items);
			}
		}
		if (source.kind === "loop") visitLoop(source.loop);
	};

	const visit = (
		key: string,
		writes: string[],
		target?: ShaderTarget,
		simulation?: PassDecl["simulation"],
		targetSize?: TextureSize,
		/** A texture the pass doesn't read, but its size follows. */
		sizedBy?: TextureSource,
		/** Where the pass is, when it isn't decided by what it reads. */
		place?: PlanNode[],
	): ReadonlySet<string> => {
		const done = visited.get(key);
		if (done) return done;
		// Reached again through what it reads: nothing of a cycle is inside anything.
		visited.set(key, new Set());
		const generated = generateShader(graph, {
			...options,
			target,
			sources,
			frame,
			targetSize: targetSize ?? CANVAS_SIZE,
		});
		const read = generated.textures.map((t) => t.source);
		const inputs = sizedBy ? [...read, sizedBy] : read;
		for (const source of inputs) include(source);
		const inside = new Set<string>();
		for (const source of inputs) for (const loop of insideOfSource(source)) inside.add(loop);
		refLoops(
			generated.frameValues.map((f) => f.ref),
			inside,
		);
		sizeLoops(targetSize ?? CANVAS_SIZE, inside);
		visited.set(key, inside);
		for (const id of writes) insideOfResource.set(id, inside);
		Object.assign(uniforms, generated.uniforms);
		const inline = generated.simulation;
		(place ?? containerOf(inside)).push({
			id: `pass:${key}`,
			kind: "render",
			program: buildProgram(generated.shader, generated.uniforms, generated),
			reads: read.map((s) => s.id),
			writes,
			...(simulation
				? { simulation }
				: inline !== undefined
					? { simulation: { id: inline } }
					: {}),
		});
		return inside;
	};

	const visitSimulation = (
		ref: SimulationRef,
		stage: SimulationStage,
		items: readonly StateItem[],
	) => {
		const id = simulationId(ref);
		const read = stage === "start" ? "previous" : "current";
		const writes = items.map((i) => stateReadId(i.texture, read));
		for (const [i, item] of items.entries()) {
			const write = writes[i] ?? "";
			resources.set(write, resourceOf(stateSource(ref, item, read)));
		}
		visit(
			`${stage}:${writes.join(",")}`,
			writes,
			{ simulation: ref, stage, items },
			{ id, stage },
			items[0]?.size,
			items[0]?.like,
		);
	};

	/**
	 * Builds the loop of a Repeat Passes zone once, as it's first read. It's
	 * put where its start, next passes and sizes allow, which is after the
	 * passes making what they read.
	 */
	const visitLoop = (ref: LoopRef) => {
		const id = loopId(ref);
		if (loops.has(id)) return;
		const state = sources.loop(ref.path, ref.zone);
		const input = sources.instance(ref.path)?.doc.nodesById.get(ref.zone);
		if (!state || !input) return;
		const decl: LoopDecl = {
			id,
			kind: "loop",
			iterations: frame.inputArg(ref.path, ref.zone, ITERATIONS_HANDLE) ?? DEFAULT_ITERATIONS,
			max: zoneMaxIterations(input),
			items: state.items.map((i) => ({
				id: i.item.id,
				texture: i.texture,
				format: i.format,
				size: i.size,
			})),
			start: [],
			body: [],
			next: [],
		};
		const loop: Loop = { decl, rank: loops.size };
		loops.set(id, loop);
		for (const item of state.items) {
			for (const read of ["current", "next", "final"] as const) {
				resources.set(
					loopReadId(item.texture, read),
					resourceOf(loopSource(ref, item, read)),
				);
			}
		}
		const inside = new Set<string>();
		for (const run of attachmentGroups(state.items)) {
			for (const stage of ["start", "next"] as const) {
				const writes = run.map((i) =>
					loopReadId(i.texture, stage === "start" ? "current" : "next"),
				);
				const passInside = visit(
					`${stage}:${writes.join(",")}`,
					writes,
					{ loop: ref, stage, items: run },
					undefined,
					run[0]?.size,
					run[0]?.like,
					stage === "start" ? decl.start : decl.next,
				);
				for (const outer of passInside) inside.add(outer);
			}
		}
		argLoops(decl.iterations, inside);
		for (const item of state.items) sizeLoops(item.size, inside);
		inside.delete(id);
		loop.inside = inside;
		containerOf(inside).push(decl);
	};

	visit(PLAN_TARGET, [PLAN_TARGET]);
	// Frame values may read the size of a texture no pass reads.
	for (const source of frame.sizedTextures()) {
		if (!resources.has(source.id)) resources.set(source.id, resourceOf(source));
	}
	Object.assign(uniforms, frame.uniforms);
	return { resources: [...resources.values()], passes: top, uniforms, frame: frame.program() };
}
