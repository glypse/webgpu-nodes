<script lang="ts">
	import { indexSwitchCases, type NodeData } from "$core";
	import { Button } from "$theme";
	import MinusIcon from "phosphor-svelte/lib/MinusIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";

	import { getGraphManager } from "../../graph-manager.svelte";

	let { id, data, disabled }: { id: string; data: NodeData; disabled: boolean } = $props();

	const graph = getGraphManager();
	const count = $derived(indexSwitchCases(data));
</script>

<div class="flex items-center gap-1 px-2 py-1">
	<span class="text-muted-foreground flex-1 text-xs">
		{count}
		{count === 1 ? "case" : "cases"}
	</span>
	<Button
		variant="ghost"
		size="icon-xs"
		class="nodrag"
		title="Remove the last case"
		disabled={disabled || count <= 1}
		onclick={() => graph.setIndexSwitchCases(id, count - 1)}
	>
		<MinusIcon />
	</Button>
	<Button
		variant="ghost"
		size="icon-xs"
		class="nodrag"
		title="Add a case"
		{disabled}
		onclick={() => graph.setIndexSwitchCases(id, count + 1)}
	>
		<PlusIcon />
	</Button>
</div>
