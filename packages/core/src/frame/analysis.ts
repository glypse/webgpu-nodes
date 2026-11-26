import { MATCH, MATCH_SELECTOR, matchedCase, WIDTH_SWITCH, widthCase } from "../enums";
import type { GraphEdge } from "../graph/document";
import { visitUpstream } from "../graph/upstream";
import { TEXTURE_SIZE, TEXTURE_SIZE_LEVEL, VIDEO, VIDEO_METADATA } from "../nodes/texture";
import { COMPONENT_COUNT } from "../nodes/vector";
import { type TextureGraph, TextureSources } from "../passes/sources";
import { isTexture } from "../types";
import {
	ITERATION_HANDLE,
	ITERATIONS_HANDLE,
	PASS_REPEAT_INPUT,
	REPEAT_INPUT,
	zoneItems,
	zoneKindOf,
} from "../zones";

/** Whether a value is the same for the whole frame, and if not, why. */
export type FrameResult = { frame: true } | { frame: false; reason: string };

/** Why a link into an input needing a frame value is invalid. */
export const FRAME_VALUE_REQUIRED = "Needs a value that's the same for the whole frame";

/** What a link does with frame values, at a group instance. */
export type FrameLink =
	/** It carries a value that's the same for the whole frame. */
	| { kind: "frame" }
	/** It gives a value computed per pixel to an input that needs a frame value. */
	| { kind: "invalid"; reason: string };

const TEXTURE_REASON = "A texture isn't a value.";

const YES: FrameResult = { frame: true };
const no = (reason: string): FrameResult => ({ frame: false, reason });

/** Nodes whose outputs the runtime knows before drawing, with no inputs of their own to check. */
const FRAME_SOURCES: ReadonlySet<string> = new Set(["time", "delta", "resolution"]);

/**
 * Which values of the graph are the same for a whole frame (the *frame* tier
 * of values, computed on the CPU), per group instance. Build one per graph
 * state (see `GraphModel.frameAnalysis`).
 */
export class FrameValueAnalysis {
	private memo = new Map<string, FrameResult>();
	/**
	 * Results found while a zone is assumed to be a frame zone: it may turn
	 * out not to be, which would make what's in it wrong to keep.
	 */
	private scratch = new Map<string, FrameResult>();
	private assuming = new Set<string>();
	private visiting = new Set<string>();

	constructor(
		private graph: TextureGraph,
		private sources: TextureSources = new TextureSources(graph),
	) {}

	/** Whether an output of a node of the document computed at `path` is a frame value. */
	isFrameValue(path: readonly string[], node: string, handle: string): boolean {
		return this.output(path, node, handle).frame;
	}

	/** Why an output isn't a frame value, if it isn't. */
	reason(path: readonly string[], node: string, handle: string): string | undefined {
		const result = this.output(path, node, handle);
		return result.frame ? undefined : result.reason;
	}

	/** What `edge`, of the document computed at `path`, does with frame values, if anything. */
	link(path: readonly string[], edge: GraphEdge): FrameLink | undefined {
		const instance = this.sources.instance(path);
		const target = instance?.doc.nodesById.get(edge.target);
		if (!instance || !target) return undefined;
		const result = this.output(path, edge.source, edge.sourceHandle);
		if (result.frame) return { kind: "frame" };
		if (result.reason === TEXTURE_REASON) return undefined;
		const input = this.graph
			.resolveDescriptor(target)
			.inputs.find((i) => i.id === edge.targetHandle);
		return input?.frame
			? {
					kind: "invalid",
					reason: `${FRAME_VALUE_REQUIRED}: ${result.reason.replace(/\.$/, "")}.`,
				}
			: undefined;
	}

	/** Whether what a node's input reads is a frame value: an unlinked one is. */
	isFrameInput(path: readonly string[], node: string, input: string): boolean {
		return this.input(path, node, input).frame;
	}

	/** Why an input doesn't read a frame value, if it doesn't. */
	inputReason(path: readonly string[], node: string, input: string): string | undefined {
		const result = this.input(path, node, input);
		return result.frame ? undefined : result.reason;
	}

	/**
	 * The inputs of a node of the document computed at `path` its value
	 * depends on: those a Match, Width Switch or Fallback doesn't pick are
	 * left out, as is whatever a Component Count reads (only its type).
	 */
	inputsRead(path: readonly string[], nodeId: string): string[] {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node) return [];
		const ids = this.graph.typeResolver
			.resolveNodeTypes(node, instance.doc.edgesByTarget.get(nodeId) ?? [], instance.bindings)
			.resolvedInputs.map((i) => i.id);
		switch (node.type) {
			case MATCH: {
				const picked = matchedCase(instance.enums, nodeId, instance.constants);
				// The node's CPU code picks its case by the selector, so it's read too.
				return picked === undefined ? ids : [MATCH_SELECTOR, picked];
			}
			case WIDTH_SWITCH: {
				const picked = widthCase(instance.enums, nodeId);
				return picked === undefined ? ids : [picked];
			}
			case COMPONENT_COUNT:
				return [];
			case "fallback":
				return [this.isPresent(path, nodeId, "value") ? "value" : "default"];
			default:
				return ids;
		}
	}

	/**
	 * Whether an input is given a value: a link from a group input unlinked
	 * where the group is used gives none, through any reroutes.
	 */
	private isPresent(path: readonly string[], nodeId: string, inputId: string): boolean {
		const instance = this.sources.instance(path);
		let edge = instance?.edgesByTarget.get(nodeId)?.find((e) => e.targetHandle === inputId);
		while (edge && instance?.doc.nodesById.get(edge.source)?.type === "reroute") {
			const source = edge.source;
			edge = instance.edgesByTarget.get(source)?.find((e) => e.targetHandle === "in");
		}
		if (!edge) return false;
		if (instance?.doc.nodesById.get(edge.source)?.type !== "group-input") return true;
		const parent = path.at(-1);
		return parent !== undefined && this.isPresent(path.slice(0, -1), parent, edge.sourceHandle);
	}

	private input(path: readonly string[], nodeId: string, inputId: string): FrameResult {
		const edges = this.sources
			.instance(path)
			?.edgesByTarget.get(nodeId)
			?.filter((e) => e.targetHandle === inputId);
		for (const edge of edges ?? []) {
			const result = this.output(path, edge.source, edge.sourceHandle);
			// A refused link gives nothing: the input has its stored value.
			if (!result.frame) return this.needsFrameValue(path, nodeId, inputId) ? YES : result;
		}
		return YES;
	}

	private needsFrameValue(path: readonly string[], nodeId: string, inputId: string): boolean {
		const node = this.sources.instance(path)?.doc.nodesById.get(nodeId);
		const inputs = node ? this.graph.resolveDescriptor(node).inputs : [];
		return inputs.find((i) => i.id === inputId)?.frame === true;
	}

	/**
	 * Whether a link of the document computed at `path` gives a value computed
	 * per pixel to an input that needs a frame value: it's treated as missing.
	 */
	isRefused(path: readonly string[], edge: GraphEdge): boolean {
		return this.link(path, edge)?.kind === "invalid";
	}

	private output(path: readonly string[], nodeId: string, handleId: string): FrameResult {
		const key = `${this.sources.pathKey(path)}|${nodeId}|${handleId}`;
		const cache = this.assuming.size > 0 ? this.scratch : this.memo;
		const known = this.memo.get(key) ?? cache.get(key);
		if (known) return known;
		if (this.visiting.has(key)) return no("It depends on its own result.");
		this.warmSources(path, nodeId);
		this.visiting.add(key);
		const result = this.compute(path, nodeId, handleId);
		this.visiting.delete(key);
		cache.set(key, result);
		return result;
	}

	/** Outputs linked into a node, found first so a long chain of links isn't recursed down. */
	private warmSources(path: readonly string[], nodeId: string): void {
		const instance = this.sources.instance(path);
		if (!instance) return;
		const prefix = `${this.sources.pathKey(path)}|`;
		const linked = (id: string): Iterable<GraphEdge> => instance.edgesByTarget.get(id) ?? [];
		visitUpstream<string>(
			nodeId,
			function* (id) {
				for (const e of linked(id)) yield e.source;
			},
			(id) =>
				[...linked(id)].every((e) =>
					this.memo.has(`${prefix}${e.source}|${e.sourceHandle}`),
				),
			(id) => {
				for (const e of linked(id)) this.output(path, e.source, e.sourceHandle);
			},
		);
	}

	private compute(path: readonly string[], nodeId: string, handleId: string): FrameResult {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node?.type) return no("Nothing gives this value.");
		const types = this.graph.typeResolver.resolveNodeTypes(
			node,
			instance.doc.edgesByTarget.get(nodeId) ?? [],
			instance.bindings,
		);
		if (isTexture(types.resolvedOutputs.find((o) => o.id === handleId)?.type)) {
			return no(TEXTURE_REASON);
		}
		const label = this.graph.resolveDescriptor(node).label;
		const type = node.type;
		if (FRAME_SOURCES.has(type)) return YES;
		// A texture's size is known to the runtime, at the level asked for.
		if (type === TEXTURE_SIZE) return this.input(path, nodeId, TEXTURE_SIZE_LEVEL);
		if (type === VIDEO) {
			return VIDEO_METADATA.has(handleId) ? YES : no(`${label}'s frame is read per pixel.`);
		}
		if (type === "group-input") {
			const parent = path.at(-1);
			return parent === undefined
				? no("A group input has no value outside a group.")
				: this.input(path.slice(0, -1), parent, handleId);
		}
		if (type === "node-group") {
			const inner = [...path, nodeId];
			const definition =
				node.group && this.graph.project.definitions.get(node.group.definitionRef);
			const outputs = definition?.nodes.filter((n) => n.type === "group-output") ?? [];
			const out =
				outputs.find((n) =>
					definition?.edgesByTarget.get(n.id)?.some((e) => e.targetHandle === handleId),
				) ?? outputs[0];
			return out ? this.input(inner, out.id, handleId) : YES;
		}
		// Every pixel of an iteration shares its counter.
		if (type === PASS_REPEAT_INPUT && handleId === ITERATION_HANDLE) return YES;
		const kind = zoneKindOf(type);
		if (kind === "simulation") return no(`${label} keeps a value for each pixel.`);
		if (kind === "repeat") return this.zoneValue(path, nodeId);

		const cpu = this.graph.resolveDescriptor(node).cpu;
		if (!cpu) return no(`${label} is computed for each pixel.`);
		const ids = this.inputsRead(path, nodeId);
		for (const id of ids) {
			const result = this.input(path, nodeId, id);
			if (!result.frame) return result;
		}
		return YES;
	}

	/**
	 * An output of a repeat zone's boundary. A zone whose inputs and next
	 * values are all frame values runs on the CPU, and so are its outputs and
	 * what's in it, its iteration included; otherwise none of them is.
	 */
	private zoneValue(path: readonly string[], nodeId: string): FrameResult {
		const instance = this.sources.instance(path);
		const zone = instance?.zones.zones.get(instance.zones.zoneOfBoundary.get(nodeId) ?? "");
		if (!instance || !zone) return no("The zone isn't paired.");
		const inside = instance.doc.nodesById.get(nodeId)?.type === REPEAT_INPUT;
		if (inside && this.assuming.has(`${this.sources.pathKey(path)}|${zone.id}`)) return YES;
		return this.zoneResult(path, zone.id);
	}

	private zoneResult(path: readonly string[], zoneId: string): FrameResult {
		const key = `${this.sources.pathKey(path)}|zone|${zoneId}`;
		const known = this.memo.get(key) ?? this.scratch.get(key);
		if (known) return known;
		const instance = this.sources.instance(path);
		const zone = instance?.zones.zones.get(zoneId);
		const output = instance?.doc.nodesById.get(zone?.outputId ?? "");
		if (!instance || !zone || !output) return no("The zone isn't paired.");
		const handles = [ITERATIONS_HANDLE, ...zoneItems(output).map((item) => item.id)];
		const assumed = `${this.sources.pathKey(path)}|${zoneId}`;
		// Its own final value read from inside it can never be known first.
		if (this.assuming.has(assumed)) return no("It depends on its own result.");
		this.assuming.add(assumed);
		// A node asked for from inside the zone is read again when the zone's next
		// values are, which isn't a cycle: the zone's item is assumed there.
		const outer = this.visiting;
		this.visiting = new Set();
		let result: FrameResult = YES;
		for (const id of handles) {
			const read = this.input(path, zone.inputId, id);
			if (!read.frame) result = read;
		}
		if (result.frame) {
			for (const item of zoneItems(output)) {
				const read = this.input(path, zone.outputId, item.id);
				if (!read.frame) result = read;
			}
		}
		this.assuming.delete(assumed);
		this.visiting = outer;
		if (this.assuming.size === 0) {
			this.scratch.clear();
			this.memo.set(key, result);
		} else {
			this.scratch.set(key, result);
		}
		return result;
	}
}
