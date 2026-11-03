import { type Asset, DEFAULT_PLAYBACK, type VideoPlayback } from "../assets/assets";
import {
	caseHandle,
	constantAt,
	type EnumDocument,
	groupConstants,
	MATCH,
	matchedCase,
} from "../enums";
import type { GraphEdge, GraphNode, HydratedGraphDocument } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { INDEX_SWITCH, INDEX_SWITCH_INDEX, indexSwitchCases } from "../nodes/index-switch";
import { IMAGE, VIDEO } from "../nodes/texture";
import { isTexture, type TypeBindings, unavailableEdges } from "../types";
import { analyzeZones } from "../zones";

/** The id of the texture an unlinked Texture input reads: transparent black. */
export const EMPTY_TEXTURE = "empty";

/**
 * An image a Texture socket reads, known while compiling. `id` names it:
 * sockets reading the same image have the same id.
 */
export type TextureSource =
	/** An asset's file, a video's frame at the project's time. */
	| { kind: "media"; id: string; asset: string; video?: VideoPlayback }
	| { kind: "empty"; id: typeof EMPTY_TEXTURE };

/** What a Texture socket reads: an image, or nothing it can read, and why. */
export type TextureResolution =
	| TextureSource
	| {
			kind: "invalid";
			id: typeof EMPTY_TEXTURE;
			reason: string;
			/** The link where it can't be read. */
			edge: string;
	  };

const EMPTY: TextureSource = { kind: "empty", id: EMPTY_TEXTURE };

/** The id of the texture an asset gives, played as `video` says when it's a video. */
export function mediaTextureId(asset: string, video?: VideoPlayback): string {
	return video
		? `media:${asset}:${String(video.start)}:${String(video.speed)}:${video.end}`
		: `media:${asset}`;
}

export type TextureGraph = Pick<
	GraphModel,
	"root" | "project" | "typeResolver" | "resolveDescriptor" | "assets"
>;

/** A document as computed for one group node (the root for the empty path). */
type Instance = {
	path: readonly string[];
	doc: HydratedGraphDocument;
	bindings: TypeBindings;
	/** Enum values known while compiling, by group-input handle. */
	constants: ReadonlyMap<string, number>;
	/** The links codegen follows, by target. */
	edgesByTarget: ReadonlyMap<string, readonly GraphEdge[]>;
	enums: EnumDocument;
};

/**
 * Resolves Texture sockets to the images they read, per group instance:
 * a group's Texture input reads what the group node it's computed for is
 * given, so a group used twice may read two images. Memoised: build one
 * per graph state.
 */
export class TextureSources {
	private instances = new Map<string, Instance | undefined>();
	private resolved = new Map<string, TextureResolution>();
	private assets: ReadonlyMap<string, Asset>;

	constructor(private graph: TextureGraph) {
		this.assets = new Map(graph.assets.map((a) => [a.id, a]));
	}

	/** The document computed at `path`, as group nodes there bind and set it. */
	instance(path: readonly string[]): Instance | undefined {
		const key = path.join("/");
		if (this.instances.has(key)) return this.instances.get(key);
		const instance = this.createInstance(path);
		this.instances.set(key, instance);
		return instance;
	}

	private createInstance(path: readonly string[]): Instance | undefined {
		if (path.length === 0) return this.documentInstance(path, this.graph.root, {}, new Map());
		const parent = this.instance(path.slice(0, -1));
		const node = parent?.doc.nodesById.get(path.at(-1) ?? "");
		const doc = node?.group && this.graph.project.definitions.get(node.group.definitionRef);
		if (!parent || !node || !doc) return undefined;
		const bindings = this.typesIn(parent.doc, node, parent.bindings).bindings ?? {};
		const constants = groupConstants(
			parent.enums,
			node,
			this.graph.project.definitions,
			bindings,
			parent.constants,
		);
		return this.documentInstance(path, doc, bindings, constants);
	}

	private documentInstance(
		path: readonly string[],
		doc: HydratedGraphDocument,
		bindings: TypeBindings,
		constants: ReadonlyMap<string, number>,
	): Instance {
		const invalid = analyzeZones(doc.nodes, doc.edges).invalidEdges;
		const unavailable = unavailableEdges(doc.edges, (id) => {
			const node = doc.nodesById.get(id);
			return node && this.typesIn(doc, node, bindings);
		});
		const edgesByTarget = new Map<string, GraphEdge[]>();
		for (const e of doc.edges) {
			if (invalid.has(e.id) || unavailable.has(e.id)) continue;
			edgesByTarget.set(e.target, [...(edgesByTarget.get(e.target) ?? []), e]);
		}
		const enums: EnumDocument = {
			nodesById: doc.nodesById,
			edgesByTarget,
			inputs: doc.inputs,
			inputType: (nodeId, inputId) => {
				const node = doc.nodesById.get(nodeId);
				const type = node && this.typesIn(doc, node, bindings);
				const input = type?.inputTypes[inputId];
				return input === undefined || isTexture(input) ? undefined : input;
			},
		};
		return { path, doc, bindings, constants, edgesByTarget, enums };
	}

	private typesIn(doc: HydratedGraphDocument, node: GraphNode, bindings: TypeBindings) {
		return this.graph.typeResolver.resolveNodeTypes(
			node,
			doc.edgesByTarget.get(node.id) ?? [],
			bindings,
		);
	}

	/** The link codegen follows into a node's input at `path`, if any. */
	feed(path: readonly string[], nodeId: string, inputId: string): GraphEdge | undefined {
		return this.instance(path)
			?.edgesByTarget.get(nodeId)
			?.find((e) => e.targetHandle === inputId);
	}

	/** What a node's Texture input reads, at `path`. */
	input(path: readonly string[], nodeId: string, inputId: string): TextureResolution {
		return this.memo(`in|${path.join("/")}|${nodeId}|${inputId}`, () => {
			const instance = this.instance(path);
			const edge = this.feed(path, nodeId, inputId);
			if (!instance || !edge) return EMPTY;
			const type = this.graph.typeResolver.inferHandleType(edge, instance.bindings);
			if (!isTexture(type)) {
				return {
					kind: "invalid",
					id: EMPTY_TEXTURE,
					reason: "Only a texture can be linked here.",
					edge: edge.id,
				};
			}
			return through(edge, this.output(path, edge.source, edge.sourceHandle));
		});
	}

	/** What a node's Texture output gives, at `path`. */
	output(path: readonly string[], nodeId: string, handleId: string): TextureResolution {
		return this.memo(`out|${path.join("/")}|${nodeId}|${handleId}`, () =>
			this.computeOutput(path, nodeId, handleId),
		);
	}

	private computeOutput(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): TextureResolution {
		const instance = this.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node) return EMPTY;
		switch (node.type) {
			case IMAGE:
			case VIDEO:
				return this.media(node);
			case "reroute":
				return this.input(path, nodeId, "in");
			case "group-input":
				return path.length === 0
					? EMPTY
					: this.input(path.slice(0, -1), path.at(-1) ?? "", handleId);
			case "node-group": {
				const def =
					node.group && this.graph.project.definitions.get(node.group.definitionRef);
				const outputs = def?.nodes.filter((n) => n.type === "group-output") ?? [];
				const output =
					outputs.find((n) =>
						def?.edgesByTarget.get(n.id)?.some((e) => e.targetHandle === handleId),
					) ?? outputs[0];
				return output ? this.input([...path, nodeId], output.id, handleId) : EMPTY;
			}
			case MATCH: {
				const picked = matchedCase(instance.enums, nodeId, instance.constants);
				return picked === undefined
					? this.unknownCase(node, "an enum known while compiling")
					: this.input(path, nodeId, picked);
			}
			case INDEX_SWITCH: {
				const index = this.knownIndex(instance, node);
				if (index === undefined)
					return this.unknownCase(node, "an index known while compiling");
				const last = indexSwitchCases(node.data) - 1;
				return this.input(path, nodeId, caseHandle(Math.min(Math.max(index, 0), last)));
			}
			default:
				return EMPTY;
		}
	}

	private media(node: GraphNode): TextureSource {
		const asset = node.data.asset;
		if (asset === undefined || !this.assets.has(asset)) return EMPTY;
		if (node.type !== VIDEO) return { kind: "media", id: mediaTextureId(asset), asset };
		const video = node.data.playback ?? DEFAULT_PLAYBACK;
		return { kind: "media", id: mediaTextureId(asset, video), asset, video };
	}

	/** An Index Switch's index while compiling: set by the calling group node, or stored while unlinked. */
	private knownIndex(instance: Instance, node: GraphNode): number | undefined {
		const constant = constantAt(
			instance.enums,
			node.id,
			INDEX_SWITCH_INDEX,
			instance.constants,
		);
		if (constant !== undefined) return constant;
		if (instance.edgesByTarget.get(node.id)?.some((e) => e.targetHandle === INDEX_SWITCH_INDEX))
			return undefined;
		const stored = node.data.values?.[INDEX_SWITCH_INDEX];
		return Math.trunc(Number(typeof stored === "object" ? stored.x : (stored ?? 0)));
	}

	/** A switch over textures whose case is only known per pixel: it reads nothing. */
	private unknownCase(node: GraphNode, what: string): TextureResolution {
		const label = this.graph.resolveDescriptor(node).label;
		return {
			kind: "invalid",
			id: EMPTY_TEXTURE,
			reason: `A ${label} picks a texture only by ${what}.`,
			edge: "",
		};
	}

	private memo(key: string, compute: () => TextureResolution): TextureResolution {
		const done = this.resolved.get(key);
		if (done) return done;
		const result = compute();
		this.resolved.set(key, result);
		return result;
	}
}

/** `resolution` reached through `edge`: an invalid one found right past it is shown on it. */
function through(edge: GraphEdge, resolution: TextureResolution): TextureResolution {
	if (resolution.kind === "invalid" && resolution.edge === "") {
		return { ...resolution, edge: edge.id };
	}
	return resolution;
}

/** The image a resolution reads: nothing for an invalid one. */
export function readSource(resolution: TextureResolution): TextureSource {
	return resolution.kind === "invalid" ? EMPTY : resolution;
}
