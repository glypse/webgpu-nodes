<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";

	import { cn, type WithoutChild } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: WithoutChild<ContextMenuPrimitive.SubTriggerProps> & {
		inset?: boolean;
	} = $props();
</script>

<ContextMenuPrimitive.SubTrigger
	bind:ref
	data-slot="context-menu-sub-trigger"
	data-inset={inset}
	class={cn(
	"focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-inset:ps-8 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	className,
)}
	{...restProps}
>
	{@render children?.()}
	<CaretRightIcon class="ml-auto" />
</ContextMenuPrimitive.SubTrigger>
