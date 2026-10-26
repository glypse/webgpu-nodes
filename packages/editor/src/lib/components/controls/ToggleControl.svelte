<script lang="ts">
	import { componentKeys, readComponent, withComponent } from "$core";
	import { Checkbox } from "$theme";

	import type { ControlProps } from "./types";

	let { type, value, disabled, onchange }: ControlProps<{ kind: "toggle" }> = $props();
</script>

<div class="flex items-center gap-2 py-1">
	{#each componentKeys(type) as comp (comp)}
		<label class="flex items-center gap-1 text-xs">
			<Checkbox
				class="nodrag"
				{disabled}
				checked={readComponent(value, comp) !== 0}
				onCheckedChange={(checked: boolean) => {
					onchange(withComponent(value, type, comp, checked ? 1 : 0));
				}}
			/>
			{#if comp !== "_"}<span class="text-muted-foreground">{comp}</span>{/if}
		</label>
	{/each}
</div>
