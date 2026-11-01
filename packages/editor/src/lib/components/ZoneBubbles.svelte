<script lang="ts">
	import { ViewportPortal } from "@xyflow/svelte";
	import { onMount } from "svelte";

	import { getDocumentView } from "../document-view";
	import { rectOf, zonePaddings } from "../geometry/node-boxes";
	import { boundaryPoints, bubblePath } from "../geometry/zone-geometry";
	import { getGraphManager } from "../graph-manager.svelte";

	const graph = getGraphManager();
	const view = getDocumentView();

	/** Fallback corner radius, until a rendered node can be measured. */
	const DEFAULT_CORNER_RADIUS = 6;

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
	 * One bubble per zone of the document in view, outermost first so inner
	 * bubbles are painted on top. Derived from the zone analysis (the same one
	 * codegen uses) and the nodes' current positions.
	 */
	const bubbles = $derived.by(() => {
		const doc = view.document;
		const nodes = doc.nodes;
		const { zones } = graph.zoneAnalysis(doc);

		const paddings = zonePaddings(zones);
		const byDepth = [...zones.values()].toSorted((a, b) => a.depth - b.depth);

		const nodeById = new Map(nodes.map((n) => [n.id, n]));
		return byDepth.flatMap((zone) => {
			const input = nodeById.get(zone.inputId);
			const output = nodeById.get(zone.outputId);
			if (!input || !output) return [];
			const rects = [...zone.members].flatMap((id) => {
				const node = nodeById.get(id);
				return node ? [rectOf(node)] : [];
			});
			const padding = paddings.get(zone.id) ?? 0;
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
