<script lang="ts">
	import { getDocumentView } from "../document-view";
	import { getGraphManager } from "../graph-manager.svelte";

	/** A frame's header: its label and note. The frame's box is drawn under the nodes. */
	let { id }: { id: string } = $props();

	const graph = getGraphManager();
	const view = getDocumentView();

	const node = $derived(view.document.nodesById.get(id));
	const label = $derived(graph.nodeLabel(id));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="frame-header frame-tint"
	data-tint={node?.data.tint}
	title="Double-click to edit the frame"
	ondblclick={() => {
		view.activate();
		graph.openSheet(id);
	}}
>
	<span class="frame-header__label">{label}</span>
	{#if node?.data.note}
		<p class="frame-header__note">{node.data.note}</p>
	{/if}
</div>
