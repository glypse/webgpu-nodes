<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		label,
		description,
		children,
	}: { label: string; description?: string; children: Snippet } = $props();
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-col gap-0.5">
		<span class="text-sm font-medium">{label}</span>
		{#if description}
			<span class="text-muted-foreground text-xs">{description}</span>
		{/if}
	</div>
	{@render children()}
</div>
