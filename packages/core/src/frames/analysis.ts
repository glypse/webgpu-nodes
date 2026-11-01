/** The type of frame nodes: labelled boxes around other nodes, for reading only. */
export const LAYOUT_FRAME = "layout-frame";

/** Colours a frame can be drawn in. */
export const FRAME_TINTS = [
	"red",
	"orange",
	"yellow",
	"green",
	"teal",
	"blue",
	"purple",
	"pink",
] as const;

export type FrameTint = (typeof FRAME_TINTS)[number];

export type Frame = {
	/** The frame node's id. */
	id: string;
	/** The frame directly enclosing it, or null. */
	parent: string | null;
	/** 0 for frames in no other frame. */
	depth: number;
	/** Nodes directly in the frame, nested frames included. */
	children: string[];
	/** Every node in the frame at any depth, nested frames included. */
	descendants: Set<string>;
};

export type FrameAnalysis = {
	frames: Map<string, Frame>;
	/** The frame directly holding each node that's in one. */
	frameOf: Map<string, string>;
};

type FramedNode = { id: string; type?: string; frame?: string };

/**
 * Frames of a document and what they hold, from the nodes' `frame`. A node
 * naming no frame of the document is in none, and so is a frame that would
 * end up inside itself.
 */
export function analyzeFrames(nodes: readonly FramedNode[]): FrameAnalysis {
	const frameIds = new Set(nodes.filter((n) => n.type === LAYOUT_FRAME).map((n) => n.id));
	const declared = new Map<string, string>();
	for (const node of nodes) {
		if (node.frame && node.frame !== node.id && frameIds.has(node.frame)) {
			declared.set(node.id, node.frame);
		}
	}

	const frameOf = new Map<string, string>();
	for (const [id, frame] of declared) {
		const seen = new Set<string>();
		let up: string | undefined = frame;
		while (up !== undefined && up !== id && !seen.has(up)) {
			seen.add(up);
			up = declared.get(up);
		}
		// Only frames on a cycle are left out of theirs: what's in them stays.
		if (up !== id) frameOf.set(id, frame);
	}

	const frames = new Map<string, Frame>();
	for (const id of frameIds) {
		frames.set(id, { id, parent: null, depth: 0, children: [], descendants: new Set() });
	}
	for (const node of nodes) {
		const frame = frameOf.get(node.id);
		if (frame === undefined) continue;
		frames.get(frame)?.children.push(node.id);
		for (let up: string | undefined = frame; up !== undefined; up = frameOf.get(up)) {
			frames.get(up)?.descendants.add(node.id);
		}
	}
	for (const frame of frames.values()) {
		frame.parent = frameOf.get(frame.id) ?? null;
		for (let up = frame.parent; up !== null; up = frameOf.get(up) ?? null) frame.depth++;
	}
	return { frames, frameOf };
}

/** The innermost frame holding every node of `nodeIds`, or null when they share none. */
export function commonFrame(analysis: FrameAnalysis, nodeIds: Iterable<string>): string | null {
	let common: string[] | undefined;
	for (const id of nodeIds) {
		const chain: string[] = [];
		for (let up = analysis.frameOf.get(id); up !== undefined; up = analysis.frameOf.get(up)) {
			chain.push(up);
		}
		common = common ? common.filter((f) => chain.includes(f)) : chain;
	}
	return common?.[0] ?? null;
}
