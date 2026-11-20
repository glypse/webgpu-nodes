import type { VideoPlayback } from "../assets/assets";
import {
	attachmentGroups,
	simulationId,
	type SimulationRef,
	type StateItem,
	type StateRead,
	stateReadId,
} from "../passes/simulation";
import { type TextureSource, TextureSources } from "../passes/sources";
import { CANVAS_SIZE, type TextureFormat, type TextureSize } from "../passes/textures";
import {
	type CodegenGraph,
	generateShader,
	type ShaderOptions,
	type ShaderTarget,
	type SimulationStage,
	type UniformValue,
} from "./generate";
import { buildProgram, type ShaderProgram } from "./program";

/** What the last pass of a plan writes: the frame drawn. */
export const PLAN_TARGET = "target";

/** A texture a plan reads or writes. Open to more kinds: buffers (compute). */
export type ResourceDecl =
	/** Written by a pass, then read. */
	| { id: string; kind: "transient"; size: TextureSize; format: TextureFormat }
	| { id: string; kind: "media"; asset: string; video?: VideoPlayback }
	/**
	 * A simulation's state item, as of the previous frame or this one: one of
	 * the two canvas-sized textures keeping it (`texture`), which swap roles
	 * as frames go by.
	 */
	| {
			id: string;
			kind: "state";
			texture: string;
			read: StateRead;
			format: TextureFormat;
			/** The simulation it's state of, by `simulationId`. */
			simulation: string;
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

/**
 * How a frame is drawn: passes in order, each reading the textures earlier
 * ones wrote (or, for a simulation's state, the previous frame's), the last
 * drawing the frame. Besides the last, passes render values linked to
 * Texture inputs, and compute simulations' state.
 */
export type RenderPlan = {
	resources: ResourceDecl[];
	passes: PassDecl[];
	/** The uniform values of every pass: each program's block holds those it reads. */
	uniforms: Record<string, UniformValue>;
};

function resourceOf(source: TextureSource): ResourceDecl {
	switch (source.kind) {
		case "render":
			return {
				id: source.id,
				kind: "transient",
				size: source.size,
				format: source.format,
			};
		case "media":
			return {
				id: source.id,
				kind: "media",
				asset: source.asset,
				...(source.video ? { video: source.video } : {}),
			};
		case "state":
			return {
				id: source.id,
				kind: "state",
				texture: source.texture,
				read: source.read,
				format: source.format,
				simulation: simulationId(source.simulation),
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
 */
export function generateRenderPlan(
	graph: CodegenGraph,
	options: Omit<ShaderOptions, "target" | "sources"> = {},
): RenderPlan {
	const sources = new TextureSources(graph);
	const passes: PassDecl[] = [];
	const resources = new Map<string, ResourceDecl>();
	const uniforms: Record<string, UniformValue> = {};
	const visited = new Set<string>();

	/** The run of a simulation's items, in its passes, holding `texture`'s. */
	const runOf = (ref: SimulationRef, texture: string): StateItem[] | undefined => {
		const state = sources.simulation(ref.path, ref.zone);
		return attachmentGroups(state?.items ?? []).find((run) =>
			run.some((i) => i.texture === texture),
		);
	};

	const visit = (
		key: string,
		writes: string[],
		target?: ShaderTarget,
		simulation?: PassDecl["simulation"],
		targetSize?: TextureSize,
	) => {
		if (visited.has(key)) return;
		visited.add(key);
		const generated = generateShader(graph, {
			...options,
			target,
			sources,
			targetSize: targetSize ?? CANVAS_SIZE,
		});
		for (const { source } of generated.textures) {
			resources.set(source.id, resourceOf(source));
			if (source.kind === "render") {
				visit(source.id, [source.id], source.target, undefined, source.size);
			}
			if (source.kind === "state") {
				const stage = source.read === "current" ? "step" : "start";
				const items = runOf(source.simulation, source.texture);
				if (items) visitSimulation(source.simulation, stage, items);
			}
		}
		Object.assign(uniforms, generated.uniforms);
		const inline = generated.simulation;
		passes.push({
			id: `pass:${key}`,
			kind: "render",
			program: buildProgram(generated.shader, generated.uniforms, generated),
			reads: generated.textures.map((t) => t.source.id),
			writes,
			...(simulation
				? { simulation }
				: inline !== undefined
					? { simulation: { id: inline } }
					: {}),
		});
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
			resources.set(write, {
				id: write,
				kind: "state",
				texture: item.texture,
				read,
				format: item.format,
				simulation: id,
			});
		}
		visit(
			`${stage}:${writes.join(",")}`,
			writes,
			{ simulation: ref, stage, items },
			{ id, stage },
		);
	};

	visit(PLAN_TARGET, [PLAN_TARGET]);
	return { resources: [...resources.values()], passes, uniforms };
}
