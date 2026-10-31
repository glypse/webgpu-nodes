<script lang="ts">
	import { DropdownMenu as MenuPrimitive } from "bits-ui";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";

	import { cn, type WithoutChild } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<MenuPrimitive.SubTriggerProps> = $props();
</script>

<MenuPrimitive.SubTrigger
	bind:ref
	class={cn(
		"focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground focus:**:text-accent-foreground flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className,
	)}
	{...restProps}
>
	{@render children?.()}
	<CaretRightIcon class="ml-auto" />
</MenuPrimitive.SubTrigger>
