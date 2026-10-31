import { nodeRegistry } from "../nodes/registry";
import { type GroupHandleDef, isConnectionCompatible } from "../types";
import type { GraphEdge, GraphNode, HydratedGraphDocument } from "./document";
import { handlesOf } from "./editing";
import { EditModel } from "./model-edits";

const FRAG_OUTPUT = "frag-output";

/** A node's output, as a link's source. */
type Source = { node: string; handle: string };

/**
 * Previewing a node, as Blender's Node Wrangler does: its output is linked
 * straight to the fragment output, replacing what was there. Inside groups,
 * each group on the way gets a viewer output carrying it up a level; viewer
 * outputs a preview no longer goes through are removed, so previews never
 * pile up.
 */
export abstract class PreviewModel extends EditModel {
	/**
	 * Preview a node of the active document: its first output that the
	 * fragment output takes, or the next one when it's already previewed.
	 * Returns whether it's previewed.
	 */
	previewNode(nodeId: string): boolean {
		const path = this.path;
		if (this.isLockedAt(path)) return false;
		const frag = this.root.nodes.find((n) => n.type === FRAG_OUTPUT);
		const fragInput = nodeRegistry[FRAG_OUTPUT]?.inputs[0];
		if (!frag || !fragInput) return false;
		const outputs = this.resolveNodeOutputs(nodeId, path).filter((o) =>
			fragInput.types.some((t) => isConnectionCompatible(o.type, t)),
		);
		if (outputs.length === 0 || !this.activeDocument.nodesById.has(nodeId)) return false;

		// From the node's level up to the root, the group the preview leaves at each step.
		const levels = [...this.walkPath(path)].reverse();
		const inner = levels[0];
		const target = inner
			? { doc: inner.definition, ...this.viewerOf(inner.definition) }
			: { doc: this.root, node: frag.id, handle: fragInput.id };
		const current = target.doc.edges.find(
			(e) =>
				e.source === nodeId && e.target === target.node && e.targetHandle === target.handle,
		);
		const index = outputs.findIndex((o) => o.id === current?.sourceHandle);
		const output = outputs[(index + 1) % outputs.length] ?? outputs[0];
		if (!output) return false;

		const kept = new Set<string>();
		let source: Source = { node: nodeId, handle: output.id };
		for (const { definition, node: instance } of levels) {
			const groupOutput = definition.nodes.find((n) => n.type === "group-output");
			if (!groupOutput) return false;
			const viewer = this.ensureViewer(definition, groupOutput);
			kept.add(viewer.id);
			this.linkInto(definition, source, { node: groupOutput.id, handle: viewer.id });
			source = { node: instance.id, handle: viewer.id };
		}
		this.linkInto(this.root, source, { node: frag.id, handle: fragInput.id });
		this.removeViewersBut(kept);
		this.rebuildTypeCache();
		return true;
	}

	/** Where a group's viewer output is fed from inside, if it has one. */
	private viewerOf(definition: HydratedGraphDocument): { node?: string; handle?: string } {
		const groupOutput = definition.nodes.find((n) => n.type === "group-output");
		return { node: groupOutput?.id, handle: handlesOf(groupOutput).find((h) => h.viewer)?.id };
	}

	/** A group's viewer output, added if it has none. */
	private ensureViewer(
		definition: HydratedGraphDocument,
		groupOutput: GraphNode,
	): GroupHandleDef {
		const handles = handlesOf(groupOutput);
		const existing = handles.find((h) => h.viewer);
		if (existing) return existing;
		const viewer: GroupHandleDef = {
			id: crypto.randomUUID(),
			label: "Viewer",
			type: { inferred: true },
			viewer: true,
		};
		this.setContent(definition, {
			nodes: definition.nodes.map((n) =>
				n.id === groupOutput.id
					? { ...n, data: { ...n.data, handles: [...handles, viewer] } }
					: n,
			),
		});
		return viewer;
	}

	/** Link `source` into an input of `doc`, replacing what fed it. */
	private linkInto(doc: HydratedGraphDocument, source: Source, target: Source) {
		const edge: GraphEdge = {
			id: crypto.randomUUID(),
			source: source.node,
			sourceHandle: source.handle,
			target: target.node,
			targetHandle: target.handle,
		};
		this.setContent(doc, {
			edges: [
				...doc.edges.filter(
					(e) => !(e.target === target.node && e.targetHandle === target.handle),
				),
				edge,
			],
		});
	}

	/** Remove every group's viewer output but `kept`, with its links. */
	private removeViewersBut(kept: ReadonlySet<string>) {
		for (const [ref, definition] of this.project.definitions) {
			if (this.isStandardLibrary(ref)) continue;
			for (const node of definition.nodes) {
				if (node.type !== "group-output") continue;
				const stale = handlesOf(node).filter((h) => h.viewer && !kept.has(h.id));
				if (stale.length > 0) {
					this.removeHandles(
						ref,
						node.id,
						stale.map((h) => h.id),
					);
				}
			}
		}
	}
}
