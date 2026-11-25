import { isTexture, type NodeDescriptor } from "../types";
import { pairedInput, pairedOutputId, zoneKindOf } from "../zones/descriptors";
import type { GraphNode, HydratedGraphDocument } from "./document";

type FrameHandles = {
	ids: Set<string>;
	nodes: HydratedGraphDocument["nodes"];
	edges: HydratedGraphDocument["edges"];
	/** The definitions it was found through, which it's out of date without. */
	used: { ref: string; doc: HydratedGraphDocument | undefined }[];
};

const frameHandleCache = new WeakMap<HydratedGraphDocument, FrameHandles>();

function currentFrameHandles(
	doc: HydratedGraphDocument,
	definitions: Map<string, HydratedGraphDocument>,
): FrameHandles | undefined {
	const known = frameHandleCache.get(doc);
	if (known?.nodes !== doc.nodes || known.edges !== doc.edges) return undefined;
	for (const { ref, doc: used } of known.used) {
		if (definitions.get(ref) !== used) return undefined;
		if (used && !currentFrameHandles(used, definitions)) return undefined;
	}
	return known;
}

/**
 * Group-input handles of a definition whose value reaches, inside, an
 * input that needs a frame value (`NodeInputDef.frame`): through reroutes,
 * nodes computed on the CPU, repeat zones, and nested groups. Reaching is
 * structural, so a handle only a Match that doesn't pick it reads is still
 * one. A group node's input for one needs a frame value too.
 */
export function frameHandleIds(
	definition: HydratedGraphDocument,
	definitions: Map<string, HydratedGraphDocument>,
	resolve: (node: GraphNode) => NodeDescriptor,
	visiting: ReadonlySet<HydratedGraphDocument> = new Set(),
): Set<string> {
	const known = currentFrameHandles(definition, definitions);
	if (known) return known.ids;
	if (visiting.has(definition)) return new Set();
	const inside = new Set([...visiting, definition]);
	const used: FrameHandles["used"] = [];
	const nested = (node: GraphNode): HydratedGraphDocument | undefined => {
		const ref = node.group?.definitionRef;
		if (ref === undefined) return undefined;
		const doc = definitions.get(ref);
		if (!used.some((u) => u.ref === ref)) used.push({ ref, doc });
		return doc;
	};
	const textureHandles = new Set(
		definition.inputs.filter((h) => isTexture(h.type)).map((h) => h.id),
	);
	const ids = new Set<string>();
	const seen = new Set<string>();

	/** Every group input of `inner` that can reach its output `handle`, whatever the nodes between. */
	const reaching = (inner: HydratedGraphDocument, handle: string): Set<string> => {
		const found = new Set<string>();
		const done = new Set<string>();
		const walk = (nodeId: string) => {
			if (done.has(nodeId)) return;
			done.add(nodeId);
			const node = inner.nodesById.get(nodeId);
			if (node?.type === "group-input") return;
			for (const edge of inner.edgesByTarget.get(nodeId) ?? []) {
				const source = inner.nodesById.get(edge.source);
				if (source?.type === "group-input") found.add(edge.sourceHandle);
				else walk(edge.source);
			}
		};
		for (const node of inner.nodes) {
			if (node.type !== "group-output") continue;
			for (const edge of inner.edgesByTarget.get(node.id) ?? []) {
				if (edge.targetHandle !== handle) continue;
				const source = inner.nodesById.get(edge.source);
				if (source?.type === "group-input") found.add(edge.sourceHandle);
				else walk(edge.source);
			}
		}
		return found;
	};

	const feeds = (nodeId: string, accepts: (handle: string) => boolean = () => true) => {
		for (const edge of definition.edgesByTarget.get(nodeId) ?? []) {
			if (accepts(edge.targetHandle)) reach(edge.source, edge.sourceHandle);
		}
	};

	/** Marks what gives the output `handle` of a node as reaching a frame input. */
	const reach = (nodeId: string, handle: string) => {
		const key = `${nodeId}|${handle}`;
		if (seen.has(key)) return;
		seen.add(key);
		const node = definition.nodesById.get(nodeId);
		if (!node) return;
		if (node.type === "group-input") {
			if (!textureHandles.has(handle)) ids.add(handle);
			return;
		}
		if (node.type === "reroute") {
			feeds(nodeId);
			return;
		}
		if (node.type === "node-group") {
			const inner = nested(node);
			if (!inner || inside.has(inner)) return;
			const inputs = reaching(inner, handle);
			feeds(nodeId, (target) => inputs.has(target));
			return;
		}
		const kind = zoneKindOf(node.type);
		if (kind === "repeat") {
			const output = pairedOutputId(node) ?? nodeId;
			const input = pairedInput(definition.nodes, output);
			for (const id of [input?.id, output]) if (id !== undefined) feeds(id);
			return;
		}
		if (kind) return;
		const descriptor = resolve(node);
		if (!descriptor.cpu) return;
		const textures = new Set(
			descriptor.inputs.filter((i) => i.types.every(isTexture)).map((i) => i.id),
		);
		feeds(nodeId, (target) => !textures.has(target));
	};

	for (const node of definition.nodes) {
		if (
			node.type === "group-input" ||
			node.type === "group-output" ||
			node.type === "reroute"
		) {
			continue;
		}
		if (node.type === "node-group") {
			const inner = nested(node);
			if (!inner || inside.has(inner)) continue;
			const handles = frameHandleIds(inner, definitions, resolve, inside);
			feeds(node.id, (target) => handles.has(target));
			continue;
		}
		const descriptor = resolve(node);
		const frame = new Set(descriptor.inputs.filter((i) => i.frame).map((i) => i.id));
		if (frame.size > 0) feeds(node.id, (target) => frame.has(target));
	}

	frameHandleCache.set(definition, {
		ids,
		nodes: definition.nodes,
		edges: definition.edges,
		used,
	});
	return ids;
}
