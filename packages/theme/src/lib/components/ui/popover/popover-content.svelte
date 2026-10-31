<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = "center",
		...restProps
	}: PopoverPrimitive.ContentProps = $props();
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		bind:ref
		{sideOffset}
		{align}
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 z-50 flex w-72 origin-(--bits-floating-transform-origin) flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 outline-hidden duration-100",
			className,
		)}
		{...restProps}
	/>
</PopoverPrimitive.Portal>
