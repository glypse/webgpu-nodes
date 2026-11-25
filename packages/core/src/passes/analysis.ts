import type { GraphEdge } from "../graph/document";
import { isTexture } from "../types";
import { type SocketRef, type TextureGraph, TextureSources } from "./sources";

/** What a link does with a texture, at a group instance. */
export type TextureLink =
	/** A texture linked to a value: sampled at the pixel. */
	| { kind: "sample" }
	/** A value linked to a Texture input: rendered to a texture first. */
	| { kind: "render"; id: string }
	/** Nothing it can read: it's drawn red, with why. */
	| { kind: "invalid"; reason: string };

/**
 * The textures of the graph as compiled, the same `TextureSources`
 * codegen reads: what each link does with them, and the renders the frame
 * needs. Memoised; build one per graph state (see `GraphModel.passAnalysis`).
 */
export class PassAnalysis {
	readonly sources: TextureSources;
	private renderCache: ReadonlyMap<string, SocketRef> | undefined;
	/** Every link is drawn, and redrawn whenever a node moves. */
	private links = new Map<string, TextureLink | undefined>();

	constructor(private graph: TextureGraph) {
		this.sources = new TextureSources(graph);
	}

	/** What `edge`, of the document computed at `path`, does with a texture, if anything. */
	link(path: readonly string[], edge: GraphEdge): TextureLink | undefined {
		const key = `${path.join("/")}|${edge.id}|${edge.source}|${edge.sourceHandle}|${edge.target}|${edge.targetHandle}`;
		if (this.links.has(key)) return this.links.get(key);
		const link = this.computeLink(path, edge);
		this.links.set(key, link);
		return link;
	}

	private computeLink(path: readonly string[], edge: GraphEdge): TextureLink | undefined {
		const instance = this.sources.instance(path);
		const target = instance?.doc.nodesById.get(edge.target);
		if (!instance || !target) return undefined;
		const types = this.graph.typeResolver;
		const targetType = types.resolveNodeTypes(
			target,
			instance.doc.edgesByTarget.get(target.id) ?? [],
			instance.bindings,
		).inputTypes[edge.targetHandle];
		const sourceType = types.inferHandleType(edge, instance.bindings);
		if (isTexture(targetType)) {
			if (this.sources.feed(path, edge.target, edge.targetHandle)?.id !== edge.id) {
				return undefined;
			}
			const read = this.sources.input(path, edge.target, edge.targetHandle);
			if (read.kind === "invalid" && read.edge === edge.id) {
				return { kind: "invalid", reason: read.reason };
			}
			return read.kind === "render" ? { kind: "render", id: read.id } : undefined;
		}
		if (!isTexture(sourceType)) return undefined;
		const read = this.sources.output(path, edge.source, edge.sourceHandle);
		return read.kind === "invalid"
			? { kind: "invalid", reason: read.reason }
			: { kind: "sample" };
	}

	/** The values the frame renders to textures, by texture id: a pass each. */
	renders(): ReadonlyMap<string, SocketRef> {
		if (this.renderCache) return this.renderCache;
		const renders = new Map<string, SocketRef>();
		const seen = new Set<string>();
		const walk = (path: readonly string[], seeds: readonly string[]) => {
			const instance = this.sources.instance(path);
			if (!instance) return;
			const queue = [...seeds];
			for (const id of queue) {
				const key = `${path.join("/")}|${id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const node = instance.doc.nodesById.get(id);
				for (const edge of instance.edgesByTarget.get(id) ?? []) {
					const link = this.link(path, edge);
					if (link?.kind === "render") {
						const read = this.sources.input(path, edge.target, edge.targetHandle);
						if (read.kind === "render") renders.set(read.id, read.target);
					}
					queue.push(edge.source);
				}
				const def =
					node?.group && this.graph.project.definitions.get(node.group.definitionRef);
				if (def) {
					const outputs = def.nodes.filter((n) => n.type === "group-output");
					walk(
						[...path, id],
						outputs.map((n) => n.id),
					);
				}
			}
		};
		walk(
			[],
			this.graph.root.nodes.filter((n) => n.type === "frag-output").map((n) => n.id),
		);
		this.renderCache = renders;
		return renders;
	}
}
