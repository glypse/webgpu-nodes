import type { GraphNode, Zone } from "$core";
import type { Node } from "@xyflow/svelte";

import type { Rect } from "./zone-geometry";

/** Fallback size for nodes SvelteFlow hasn't measured yet. */
const DEFAULT_SIZE = { width: 180, height: 120 };

/** Base distance between a zone's nodes and its bubble. */
const ZONE_PADDING = 28;
/** Extra room per nested zone level, so an outer bubble wraps inner ones. */
const ZONE_NESTING_STEP = 22;

/** A node's box on the canvas, as SvelteFlow measured it. */
export function rectOf(node: GraphNode & Pick<Node, "measured">): Rect {
	return {
		x: node.position.x,
		y: node.position.y,
		width: node.measured?.width ?? node.width ?? DEFAULT_SIZE.width,
		height: node.measured?.height ?? node.height ?? DEFAULT_SIZE.height,
	};
}

/** The distance between each zone's nodes and its bubble, by zone id: more around nested zones. */
export function zonePaddings(zones: ReadonlyMap<string, Zone>): Map<string, number> {
	// How many zone levels each zone contains (0 = no nested zone).
	const height = new Map<string, number>();
	const deepestFirst = [...zones.values()].toSorted((a, b) => b.depth - a.depth);
	for (const zone of deepestFirst) {
		if (!height.has(zone.id)) height.set(zone.id, 0);
		if (zone.parent) {
			const childHeight = (height.get(zone.id) ?? 0) + 1;
			height.set(zone.parent, Math.max(height.get(zone.parent) ?? 0, childHeight));
		}
	}
	return new Map(
		[...height].map(([id, levels]) => [id, ZONE_PADDING + ZONE_NESTING_STEP * levels]),
	);
}
