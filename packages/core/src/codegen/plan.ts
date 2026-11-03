import type { VideoPlayback } from "../assets/assets";
import { type SocketRef, type TextureSource, TextureSources } from "../passes/sources";
import {
	type CodegenGraph,
	generateShader,
	type ShaderOptions,
	type UniformValue,
} from "./generate";
import { buildProgram, type ShaderProgram } from "./program";

/** What the last pass of a plan writes: the frame drawn. */
export const PLAN_TARGET = "target";

/**
 * A texture a plan reads or writes. Open to more kinds: persistent ones
 * keeping history (feedback), buffers (compute), sizes other than the
 * canvas'.
 */
export type ResourceDecl =
	/** Written by a pass, then read: a texture of the canvas' size (`relative` times it). */
	| { id: string; kind: "transient"; size: { relative: number }; format: "rgba16float" }
	| { id: string; kind: "media"; asset: string; video?: VideoPlayback }
	| { id: string; kind: "empty" };

/** A program drawing one texture (`writes`, or the frame for `PLAN_TARGET`). */
export type PassDecl = {
	id: string;
	kind: "render";
	program: ShaderProgram;
	/** The resources the program reads, by id. */
	reads: string[];
	writes: string;
};

/**
 * How a frame is drawn: passes in order, each reading the textures earlier
 * ones wrote, the last drawing the frame. Values rendered to textures (a
 * value linked to a Texture input) are the only passes besides the last.
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
				size: { relative: 1 },
				format: "rgba16float",
			};
		case "media":
			return {
				id: source.id,
				kind: "media",
				asset: source.asset,
				...(source.video ? { video: source.video } : {}),
			};
		case "empty":
			return { id: source.id, kind: "empty" };
	}
}

/**
 * The passes drawing the graph: the fragment output's, after those of the
 * values it reads rendered to textures, and of the values those read, each
 * once however many read it.
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

	const visit = (writes: string, target?: SocketRef) => {
		if (visited.has(writes)) return;
		visited.add(writes);
		const generated = generateShader(graph, { ...options, target, sources });
		for (const { source } of generated.textures) {
			resources.set(source.id, resourceOf(source));
			if (source.kind === "render") visit(source.id, source.target);
		}
		Object.assign(uniforms, generated.uniforms);
		passes.push({
			id: `pass:${writes}`,
			kind: "render",
			program: buildProgram(generated.shader, generated.uniforms, generated),
			reads: generated.textures.map((t) => t.source.id),
			writes,
		});
	};
	visit(PLAN_TARGET);
	return { resources: [...resources.values()], passes, uniforms };
}
