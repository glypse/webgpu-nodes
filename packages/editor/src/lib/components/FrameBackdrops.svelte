<script lang="ts">
	import { ViewportPortal } from "@xyflow/svelte";

	import { getGraphManager } from "../graph-manager.svelte";
	import { getGraphView } from "../graph-view.svelte";

	const graph = getGraphManager();
	const view = getGraphView();

	/** Every frame's box, outermost first so inner ones are painted on top. */
	const backdrops = $derived.by(() => {
		const doc = view.document;
		const { frames } = graph.frameAnalysis(doc);
		return [...view.frameBoxes]
			.map(([id, box]) => {
				const node = doc.nodesById.get(id);
				return {
					id,
					box,
					depth: frames.get(id)?.depth ?? 0,
					tint: node?.data.tint,
					selected: node?.selected ?? false,
				};
			})
			.toSorted((a, b) => a.depth - b.depth);
	});
</script>

<ViewportPortal target="back">
	{#each backdrops as backdrop (backdrop.id)}
		<div
			class="frame-backdrop frame-tint"
			class:frame-backdrop--selected={backdrop.selected}
			class:frame-backdrop--drop={view.dropFrame === backdrop.id}
			data-tint={backdrop.tint}
			style:transform="translate({backdrop.box.x}px, {backdrop.box.y}px)"
			style:width="{backdrop.box.width}px"
			style:height="{backdrop.box.height}px"
			aria-hidden="true"
		></div>
	{/each}
</ViewportPortal>
