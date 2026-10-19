<script lang="ts">
	import { ViewportPortal } from "@xyflow/svelte";
	import { onMount } from "svelte";

	import { getGraphManager } from "./graph-state.svelte";
	import type { GroupedNode } from "./types";
	import { boundaryPoints, bubblePath, type Rect } from "./zone-geometry";

	const graph = getGraphManager();

	/** Base distance between a zone's nodes and its outline. */
	const PADDING = 28;
	/** Extra room per nested zone level, so an outer bubble wraps inner ones. */
	const NESTING_STEP = 22;
	/** Fallback corner radius, until a rendered node can be measured. */
	const DEFAULT_CORNER_RADIUS = 6;
	/** Fallback size for nodes SvelteFlow hasn't measured yet. */
	const DEFAULT_SIZE = { width: 180, height: 120 };

	function rectOf(node: GroupedNode): Rect {
		return {
			x: node.position.x,
			y: node.position.y,
			width: node.measured?.width ?? node.width ?? DEFAULT_SIZE.width,
			height: node.measured?.height ?? node.height ?? DEFAULT_SIZE.height,
		};
	}

	/**
	 * Bubble corners use the nodes' own corner radius (from the theme), read
	 * from a rendered node so the two can't drift apart.
	 */
	let cornerRadius = $state(DEFAULT_CORNER_RADIUS);
	onMount(() => {
		const node = document.querySelector(".svelte-flow__node");
		const radius = node ? parseFloat(getComputedStyle(node).borderTopLeftRadius) : NaN;
		if (Number.isFinite(radius)) cornerRadius = radius;
	});

	/**
	 * One bubble per zone of the active document, outermost first so inner
	 * bubbles are painted on top. Derived from the zone analysis (the same one
	 * codegen uses) and the nodes' current positions.
	 */
	const bubbles = $derived.by(() => {
		const doc = graph.activeDocument;
		const nodes = doc.nodes;
		const { zones } = graph.zoneAnalysis(doc);

		// How many zone levels each zone contains (0 = no nested zone).
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on every derivation
		const height = new Map<string, number>();
		const byDepth = [...zones.values()].toSorted((a, b) => b.depth - a.depth);
		for (const zone of byDepth) {
			if (!height.has(zone.id)) height.set(zone.id, 0);
			if (zone.parent) {
				const childHeight = (height.get(zone.id) ?? 0) + 1;
				height.set(zone.parent, Math.max(height.get(zone.parent) ?? 0, childHeight));
			}
		}

		const nodeById = new Map(nodes.map((n) => [n.id, n]));
		return byDepth.toReversed().flatMap((zone) => {
			const input = nodeById.get(zone.inputId);
			const output = nodeById.get(zone.outputId);
			if (!input || !output) return [];
			const rects = [...zone.members].flatMap((id) => {
				const node = nodeById.get(id);
				return node ? [rectOf(node)] : [];
			});
			const padding = PADDING + NESTING_STEP * (height.get(zone.id) ?? 0);
			// The outline cuts through the middle of the boundary nodes.
			const edges = boundaryPoints(rectOf(input), rectOf(output), padding);
			const path = bubblePath(rects, padding, edges, cornerRadius);
			return path ? [{ id: zone.id, path }] : [];
		});
	});
</script>

<ViewportPortal target="back">
	<svg class="zone-bubbles" aria-hidden="true">
		{#each bubbles as bubble (bubble.id)}
			<path class="zone-bubble" d={bubble.path} />
		{/each}
	</svg>
</ViewportPortal>

<style>
	.zone-bubbles {
		position: absolute;
		top: 0;
		left: 0;
		width: 1px;
		height: 1px;
		overflow: visible;
		pointer-events: none;
	}

	.zone-bubble {
		fill: color-mix(in oklab, var(--color-zone-repeat) 16%, transparent);
		stroke: color-mix(in oklab, var(--color-zone-repeat) 55%, transparent);
		stroke-width: 1.5px;
		vector-effect: non-scaling-stroke;
	}
</style>
