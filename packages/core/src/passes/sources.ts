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
import {
	analyzeZones,
	simulatingDefinitions,
	SIMULATION_INPUT,
	SIMULATION_OUTPUT,
	type ZoneAnalysis,
	zoneItems,
} from "../zones";
import {
	simulationId,
	type SimulationRef,
	type SimulationState,
	type StateFormat,
	stateFormat,
	type StateItem,
	type StateRead,
	stateReadId,
	stateTextureId,
} from "./simulation";

/** The id of the texture an unlinked Texture input reads: transparent black. */
export const EMPTY_TEXTURE = "empty";

/**
 * An image a Texture socket reads, known while compiling. `id` names it:
 * sockets reading the same image have the same id.
 */
export type TextureSource =
	/** An asset's file, a video's frame at the project's time. */
	| { kind: "media"; id: string; asset: string; video?: VideoPlayback }
	/** A value rendered over a canvas-sized texture, in a pass of its own. */
	| { kind: "render"; id: string; target: SocketRef }
	/** A simulation's state item, kept in a canvas-sized texture between frames. */
	| {
			kind: "state";
			id: string;
			/** The texture keeping it (see `stateTextureId`), whichever frame is read. */
			texture: string;
			read: StateRead;
			format: StateFormat;
			simulation: SimulationRef;
	  }
	| { kind: "empty"; id: typeof EMPTY_TEXTURE };

/** An output of a node of the document computed at `path` (see `TextureSources.instance`). */
export type SocketRef = { path: readonly string[]; node: string; handle: string };

/** The id of the texture a value is rendered into: one per output and group instance. */
export function renderTextureId({ path, node, handle }: SocketRef): string {
	return `render:${[...path, node].join("/")}:${handle}`;
}

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
	zones: ZoneAnalysis;
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
		const zones = analyzeZones(doc.nodes, doc.edges, {
			simulating: simulatingDefinitions(this.graph.project.definitions),
		});
		const invalid = zones.invalidEdges;
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
		return { path, doc, bindings, zones, constants, edgesByTarget, enums };
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
			if (isTexture(type)) {
				return through(edge, this.output(path, edge.source, edge.sourceHandle));
			}
			// A value is rendered once per frame: it can't change per iteration of a loop.
			if (this.readsZoneState(path, edge.source, edge.sourceHandle)) {
				return {
					kind: "invalid",
					id: EMPTY_TEXTURE,
					reason: "A value computed in a repeat zone can't be rendered to a texture: it changes with every iteration.",
					edge: edge.id,
				};
			}
			const target = { path, node: edge.source, handle: edge.sourceHandle };
			return { kind: "render", id: renderTextureId(target), target };
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
			case SIMULATION_INPUT:
				return this.state(path, instance, nodeId, handleId, "previous");
			case SIMULATION_OUTPUT:
				return this.state(path, instance, nodeId, handleId, "current");
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

	private simulations = new Map<string, SimulationState | undefined>();

	/**
	 * The state of the simulation zone `zone` (its input's id) of the document
	 * computed at `path`, its items typed as they are there.
	 */
	simulation(path: readonly string[], zone: string): SimulationState | undefined {
		const ref = { path, zone };
		const id = simulationId(ref);
		if (this.simulations.has(id)) return this.simulations.get(id);
		const instance = this.instance(path);
		const analysed = instance?.zones.zones.get(zone);
		const input = instance?.doc.nodesById.get(zone);
		let state: SimulationState | undefined;
		if (instance && input && analysed?.kind === "simulation") {
			const outputs = this.typesIn(instance.doc, input, instance.bindings).resolvedOutputs;
			const items = zoneItems(instance.doc.nodesById.get(analysed.outputId)).map(
				(item): StateItem => {
					const type = outputs.find((o) => o.id === item.id)?.type ?? "f32";
					return {
						item,
						type,
						format: stateFormat(type),
						texture: stateTextureId(ref, item.id),
					};
				},
			);
			state = { ref, id, items };
		}
		this.simulations.set(id, state);
		return state;
	}

	/** A state item of the simulation computed at `path` that a boundary node gives. */
	private state(
		path: readonly string[],
		instance: Instance,
		nodeId: string,
		handleId: string,
		read: StateRead,
	): TextureSource {
		const zone = instance.zones.zoneOfBoundary.get(nodeId);
		const state = zone === undefined ? undefined : this.simulation(path, zone);
		const item = state?.items.find((i) => i.item.id === handleId);
		if (!state || !item) return EMPTY;
		return stateSource(state.ref, item, read);
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

	private zoneState = new Map<string, boolean>();

	/**
	 * Whether a node's outputs at `path` depend on the state or iteration of
	 * a repeat zone they're computed in (or that the group node they're
	 * computed through is fed from). A zone's final values don't, nor does a
	 * simulation's state, the same over a frame.
	 */
	readsZoneState(path: readonly string[], nodeId: string, handle: string): boolean {
		const instance = this.instance(path);
		if (!instance) return false;
		const zones = instance.zones;
		/** The repeat zone a node is computed in, a Repeat Output's being around its loop. */
		const zoneOf = (id: string): string | null => {
			const own = zones.zones.get(zones.zoneOfBoundary.get(id) ?? "");
			let zone = own
				? id === own.outputId
					? own.parent
					: own.id
				: (zones.nodeZone.get(id) ?? null);
			// A simulation is never in a repeat zone: a node in one is in none.
			if (zone !== null && zones.zones.get(zone)?.kind === "simulation") zone = null;
			return zone;
		};
		const done = new Map<string, boolean>();
		// Zones whose final values are read: what they compute is complete.
		const visit = (id: string, handle: string, closed: ReadonlySet<string>): boolean => {
			const node = instance.doc.nodesById.get(id);
			const key = `${id}|${node?.type === "group-input" ? handle : ""}|${[...closed].join(",")}`;
			const known = done.get(key);
			if (known !== undefined) return known;
			done.set(key, false);
			const zone = zoneOf(id);
			let reads = zone !== null && !closed.has(zone);
			if (!reads && node?.type === "group-input" && path.length > 0) {
				reads = this.readsZoneStateAt(path.slice(0, -1), path.at(-1) ?? "", handle);
			}
			if (!reads) {
				const own = zones.zones.get(zones.zoneOfBoundary.get(id) ?? "");
				const closing = own?.outputId === id ? own : undefined;
				const inner = closing ? new Set([...closed, closing.id]) : closed;
				const feeds = [...(instance.edgesByTarget.get(id) ?? [])];
				if (closing) feeds.push(...(instance.edgesByTarget.get(closing.inputId) ?? []));
				reads = feeds.some((e) => visit(e.source, e.sourceHandle, inner));
			}
			done.set(key, reads);
			return reads;
		};
		const key = `${path.join("/")}|${nodeId}|${handle}`;
		const known = this.zoneState.get(key);
		if (known !== undefined) return known;
		const reads = visit(nodeId, handle, new Set());
		this.zoneState.set(key, reads);
		return reads;
	}

	/** Whether what feeds a group node's input at `path` reads a zone's state there. */
	private readsZoneStateAt(path: readonly string[], groupNodeId: string, input: string): boolean {
		const feed = this.feed(path, groupNodeId, input);
		return !!feed && this.readsZoneState(path, feed.source, feed.sourceHandle);
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

/** The texture keeping a state item, as read in `read`'s frame. */
export function stateSource(
	simulation: SimulationRef,
	{ texture, format }: Pick<StateItem, "texture" | "format">,
	read: StateRead,
): Extract<TextureSource, { kind: "state" }> {
	return { kind: "state", id: stateReadId(texture, read), texture, read, format, simulation };
}

/** The image a resolution reads: nothing for an invalid one. */
export function readSource(resolution: TextureResolution): TextureSource {
	return resolution.kind === "invalid" ? EMPTY : resolution;
}
