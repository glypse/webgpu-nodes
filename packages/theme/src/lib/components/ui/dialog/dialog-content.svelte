<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import XIcon from "phosphor-svelte/lib/XIcon";
	import type { Snippet } from "svelte";

	import { cn, type WithoutChildrenOrChild } from "../../../utils.js";
	import Button from "../button.svelte";

	let {
		ref = $bindable(null),
		class: className,
		side,
		showCloseButton = true,
		children,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		/** Slide in along that edge, as a sheet, instead of centring. */
		side?: "top" | "right" | "bottom" | "left";
		showCloseButton?: boolean;
		children: Snippet;
	} = $props();
</script>

<DialogPrimitive.Portal>
	<DialogPrimitive.Overlay
		class="data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs"
	/>
	<DialogPrimitive.Content
		bind:ref
		data-side={side}
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed z-50 text-sm outline-none",
			side
				? "data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10 flex flex-col gap-4 bg-clip-padding shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm"
				: "data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 top-1/2 left-1/2 grid w-full max-w-[calc(100%_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 ring-1 duration-100 sm:max-w-sm",
			className,
		)}
		{...restProps}
	>
		{@render children()}
		{#if showCloseButton}
			<DialogPrimitive.Close>
				{#snippet child({ props })}
					<Button
						variant="ghost"
						class={side ? "absolute top-3 right-3" : "absolute top-2 right-2"}
						size="icon-sm"
						{...props}
					>
						<XIcon />
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPrimitive.Portal>
