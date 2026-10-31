<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ToggleGroupPrimitive.ItemProps = $props();
</script>

<ToggleGroupPrimitive.Item
	bind:ref
	class={cn(
		"hover:text-foreground hover:bg-muted data-[state=on]:bg-muted border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 border border-l-0 bg-transparent px-2 text-sm font-medium whitespace-nowrap transition-all outline-none group-data-[size=sm]/toggle-group:h-7 group-data-[size=sm]/toggle-group:min-w-7 group-data-[size=sm]/toggle-group:text-[0.8rem] first:rounded-l-lg first:border-l last:rounded-r-lg focus:z-10 focus-visible:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 group-data-[size=sm]/toggle-group:[&_svg:not([class*='size-'])]:size-3.5",
		className,
	)}
	{...restProps}
/>
