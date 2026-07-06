<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "../../../utils.js";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: WithoutChild<MenubarPrimitive.SubTriggerProps> & {
		inset?: boolean;
	} = $props();
</script>

<MenubarPrimitive.SubTrigger
	bind:ref
	data-slot="menubar-sub-trigger"
	data-inset={inset}
	class={cn(
		"focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground gap-1.5 rounded-md px-1.5 py-1 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 flex cursor-default items-center outline-none select-none",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<CaretRightIcon class="cn-rtl-flip ml-auto size-4" />
</MenubarPrimitive.SubTrigger>
