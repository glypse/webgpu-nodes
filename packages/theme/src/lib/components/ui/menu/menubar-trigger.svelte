<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.TriggerProps = $props();
</script>

<MenubarPrimitive.Trigger
	bind:ref
	class={cn(
		"hover:bg-muted aria-expanded:bg-muted bg-muted/50 flex items-center rounded-sm px-1.5 py-[2px] text-sm font-medium select-none",
		className,
	)}
	{...restProps}
/>
