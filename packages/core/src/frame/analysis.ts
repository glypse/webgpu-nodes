import { MATCH, matchedCase, WIDTH_SWITCH, widthCase } from "../enums";
import { TEXTURE_SIZE } from "../nodes/texture";
import { COMPONENT_COUNT } from "../nodes/vector";
import { type TextureGraph, TextureSources } from "../passes/sources";
import { isTexture } from "../types";
import { ITERATIONS_HANDLE, REPEAT_INPUT, zoneItems, zoneKindOf } from "../zones";

/** Whether a value is the same for the whole frame, and if not, why. */
export type FrameResult = { frame: true } | { frame: false; reason: string };

const YES: FrameResult = { frame: true };
const no = (reason: string): FrameResult => ({ frame: false, reason });

/** Nodes whose outputs the runtime knows before drawing, with no inputs of their own to check. */
const FRAME_SOURCES: ReadonlySet<string> = new Set(["time", "delta", "resolution", TEXTURE_SIZE]);

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

	/** Whether what a node's input reads is a frame value: an unlinked one is. */
	isFrameInput(path: readonly string[], node: string, input: string): boolean {
		return this.input(path, node, input).frame;
	}

	/** Why an input doesn't read a frame value, if it doesn't. */
	inputReason(path: readonly string[], node: string, input: string): string | undefined {
		const result = this.input(path, node, input);
		return result.frame ? undefined : result.reason;
	}

	private input(path: readonly string[], nodeId: string, inputId: string): FrameResult {
		const edges = this.sources
			.instance(path)
			?.edgesByTarget.get(nodeId)
			?.filter((e) => e.targetHandle === inputId);
		for (const edge of edges ?? []) {
			const result = this.output(path, edge.source, edge.sourceHandle);
			if (!result.frame) return result;
		}
		return YES;
	}

	private output(path: readonly string[], nodeId: string, handleId: string): FrameResult {
		const key = `${path.join("/")}|${nodeId}|${handleId}`;
		const cache = this.assuming.size > 0 ? this.scratch : this.memo;
		const known = this.memo.get(key) ?? cache.get(key);
		if (known) return known;
		if (this.visiting.has(key)) return no("It depends on itself.");
		this.visiting.add(key);
		const result = this.compute(path, nodeId, handleId);
		this.visiting.delete(key);
		cache.set(key, result);
		return result;
	}

	private compute(path: readonly string[], nodeId: string, handleId: string): FrameResult {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node?.type) return no("There's nothing to read.");
		const types = this.graph.typeResolver.resolveNodeTypes(
			node,
			instance.doc.edgesByTarget.get(nodeId) ?? [],
			instance.bindings,
		);
		if (isTexture(types.resolvedOutputs.find((o) => o.id === handleId)?.type)) {
			return no("A texture isn't a value.");
		}
		const label = this.graph.resolveDescriptor(node).label;
		const type = node.type;
		if (FRAME_SOURCES.has(type)) return YES;
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
		const kind = zoneKindOf(type);
		if (kind === "simulation") return no(`${label} keeps its state for each pixel.`);
		if (kind === "repeat") return this.zoneValue(path, nodeId);

		const cpu = this.graph.resolveDescriptor(node).cpu;
		if (!cpu) return no(`${label} is computed for each pixel.`);
		let ids = types.resolvedInputs.map((i) => i.id);
		if (type === MATCH) {
			const picked = matchedCase(instance.enums, nodeId, instance.constants);
			if (picked !== undefined) ids = [picked];
		} else if (type === WIDTH_SWITCH) {
			const picked = widthCase(instance.enums, nodeId);
			if (picked !== undefined) ids = [picked];
		} else if (type === COMPONENT_COUNT) {
			ids = [];
		} else if (type === "fallback") {
			const linked = instance.edgesByTarget
				.get(nodeId)
				?.some((e) => e.targetHandle === "value");
			ids = [linked ? "value" : "default"];
		}
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
		if (inside && this.assuming.has(zone.id)) return YES;
		return this.zoneResult(path, zone.id);
	}

	private zoneResult(path: readonly string[], zoneId: string): FrameResult {
		const key = `${path.join("/")}|zone|${zoneId}`;
		const known = this.memo.get(key) ?? this.scratch.get(key);
		if (known) return known;
		const instance = this.sources.instance(path);
		const zone = instance?.zones.zones.get(zoneId);
		const output = instance?.doc.nodesById.get(zone?.outputId ?? "");
		if (!instance || !zone || !output) return no("The zone isn't paired.");
		const handles = [ITERATIONS_HANDLE, ...zoneItems(output).map((item) => item.id)];
		this.assuming.add(zoneId);
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
		this.assuming.delete(zoneId);
		if (this.assuming.size === 0) {
			this.scratch.clear();
			this.memo.set(key, result);
		} else {
			this.scratch.set(key, result);
		}
		return result;
	}
}
