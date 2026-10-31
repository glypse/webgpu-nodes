<script lang="ts">
	import { Select as SelectPrimitive } from "bits-ui";
	import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
	import CaretUpIcon from "phosphor-svelte/lib/CaretUpIcon";

	import { cn, type WithoutChild } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		children,
		preventScroll = true,
		...restProps
	}: WithoutChild<SelectPrimitive.ContentProps> = $props();

	const scrollButtonClass =
		"bg-popover z-10 flex w-full cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4";
</script>

<SelectPrimitive.Portal>
	<SelectPrimitive.Content
		bind:ref
		{sideOffset}
		{preventScroll}
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 relative isolate z-50 min-w-36 overflow-x-hidden overflow-y-auto rounded-lg shadow-md ring-1 duration-100",
			className,
		)}
		{...restProps}
	>
		<SelectPrimitive.ScrollUpButton class={cn(scrollButtonClass, "top-0")}>
			<CaretUpIcon />
		</SelectPrimitive.ScrollUpButton>
		<SelectPrimitive.Viewport
			class="h-(--bits-select-anchor-height) w-full min-w-(--bits-select-anchor-width) scroll-my-1 p-1"
		>
			{@render children?.()}
		</SelectPrimitive.Viewport>
		<SelectPrimitive.ScrollDownButton class={cn(scrollButtonClass, "bottom-0")}>
			<CaretDownIcon />
		</SelectPrimitive.ScrollDownButton>
	</SelectPrimitive.Content>
</SelectPrimitive.Portal>
