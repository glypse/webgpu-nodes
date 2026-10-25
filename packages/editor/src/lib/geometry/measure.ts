import type { NodeGeometry } from "$core";
import type { InternalNode } from "@xyflow/svelte";

type HandleBounds = NonNullable<InternalNode["internals"]["handleBounds"]>;

/** A node's size and handle offsets as SvelteFlow measured them. */
export function measureInternalNode(internal: InternalNode | undefined): NodeGeometry | undefined {
	const width = internal?.measured.width;
	const height = internal?.measured.height;
	if (!internal || width === undefined || height === undefined) return undefined;
	const offsets = (handles: HandleBounds["source"] | undefined) =>
		new Map(
			(handles ?? []).flatMap((h) => (h.id ? [[h.id, h.y + h.height / 2] as const] : [])),
		);
	const bounds = internal.internals.handleBounds;
	return { width, height, inputs: offsets(bounds?.target), outputs: offsets(bounds?.source) };
}
