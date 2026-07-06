<script lang="ts">
	import { SvelteFlowProvider } from "@xyflow/svelte";

	import { getGraphManager } from "./graph-state.svelte";
	import GraphContent from "./GraphContent.svelte";

	const graph = getGraphManager();

	let { class: className, frag = $bindable() }: { class?: string; frag?: string } = $props();
</script>

<SvelteFlowProvider>
	<GraphContent
		bind:nodes={graph.nodes}
		bind:edges={graph.edges}
		bind:nodeIdCounter={graph.nodeIdCounter}
		bind:frag
		class={className}
	/>
</SvelteFlowProvider>
