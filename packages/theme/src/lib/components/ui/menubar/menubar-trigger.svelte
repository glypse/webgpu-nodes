<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn } from "$theme/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.TriggerProps = $props();
</script>

<MenubarPrimitive.Trigger
	bind:ref
	data-slot="menubar-trigger"
	class={cn(
		"hover:bg-muted aria-expanded:bg-muted bg-muted/50 rounded-sm px-1.5 py-[2px] text-sm font-medium flex items-center select-none",
		className
	)}
	{...restProps}
/>
