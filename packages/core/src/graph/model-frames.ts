import { commonFrame, type FrameAnalysis, LAYOUT_FRAME } from "../frames";
import { defaultDataForType } from "../nodes/registry";
import type { GraphNode } from "./document";
import { EditModel } from "./model-edits";

/** The frames around a node, innermost first. */
function framesAround(analysis: FrameAnalysis, nodeId: string): string[] {
	const chain: string[] = [];
	for (let up = analysis.frameOf.get(nodeId); up !== undefined; up = analysis.frameOf.get(up)) {
		chain.push(up);
	}
	return chain;
}

/**
 * The nodes of `ids` in none of the others' frames: moving those moves the
 * rest along, inside them.
 */
function outermost(analysis: FrameAnalysis, ids: ReadonlySet<string>): string[] {
	return [...ids].filter((id) => !framesAround(analysis, id).some((f) => ids.has(f)));
}

/** Putting nodes of the document in view in frames, and taking them out. */
export abstract class FrameModel extends EditModel {
	/**
	 * Put nodes of the active document in a new frame, itself in the
	 * innermost frame they share, and select it. Returns its id.
	 */
	frameNodes(nodeIds: Iterable<string>): string | undefined {
		if (this.isLocked) return undefined;
		const doc = this.activeDocument;
		const analysis = this.frameAnalysis(doc);
		const ids = new Set([...nodeIds].filter((id) => doc.nodesById.has(id)));
		const moved = new Set(outermost(analysis, ids));
		const nodes = doc.nodes.filter((n) => moved.has(n.id));
		if (nodes.length === 0) return undefined;
		const parent = commonFrame(analysis, moved);
		const frame: GraphNode = {
			id: crypto.randomUUID(),
			type: LAYOUT_FRAME,
			data: defaultDataForType(LAYOUT_FRAME),
			position: {
				x: Math.min(...nodes.map((n) => n.position.x)),
				y: Math.min(...nodes.map((n) => n.position.y)),
			},
			...(parent === null ? {} : { frame: parent }),
			selected: true,
		};
		this.setContent(doc, {
			nodes: [
				...doc.nodes.map((n) =>
					moved.has(n.id)
						? { ...n, frame: frame.id, selected: false }
						: n.selected
							? { ...n, selected: false }
							: n,
				),
				frame,
			],
		});
		this.selectedNodeIds = [frame.id];
		return frame.id;
	}

	/**
	 * Put nodes of the active document in the frame `frameId`, or in none
	 * with null. A frame can't go in itself or a frame it holds; nodes in
	 * the frame of another node given stay in it. Returns whether any moved.
	 */
	setNodesFrame(nodeIds: Iterable<string>, frameId: string | null): boolean {
		if (this.isLocked) return false;
		const doc = this.activeDocument;
		if (frameId !== null && doc.nodesById.get(frameId)?.type !== LAYOUT_FRAME) return false;
		const analysis = this.frameAnalysis(doc);
		const around = frameId === null ? [] : [frameId, ...framesAround(analysis, frameId)];
		const ids = new Set([...nodeIds].filter((id) => doc.nodesById.has(id)));
		const moved = new Set(
			outermost(analysis, ids).filter(
				(id) => !around.includes(id) && (analysis.frameOf.get(id) ?? null) !== frameId,
			),
		);
		if (moved.size === 0) return false;
		this.setContent(doc, {
			nodes: doc.nodes.map((n) =>
				moved.has(n.id) ? { ...n, frame: frameId ?? undefined } : n,
			),
		});
		return true;
	}

	/**
	 * Take nodes of the active document out of their frame, into the frame
	 * around it if any. Returns whether any moved.
	 */
	removeFromFrame(nodeIds: Iterable<string>): boolean {
		if (this.isLocked) return false;
		const doc = this.activeDocument;
		const analysis = this.frameAnalysis(doc);
		const ids = new Set(nodeIds);
		const moved = new Map(
			outermost(analysis, ids).flatMap((id) => {
				const frame = analysis.frameOf.get(id);
				return frame === undefined ? [] : [[id, analysis.frameOf.get(frame)] as const];
			}),
		);
		if (moved.size === 0) return false;
		this.setContent(doc, {
			nodes: doc.nodes.map((n) => (moved.has(n.id) ? { ...n, frame: moved.get(n.id) } : n)),
		});
		return true;
	}
}
