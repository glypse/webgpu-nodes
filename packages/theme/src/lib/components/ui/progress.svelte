<script lang="ts">
	import { Progress as ProgressPrimitive } from "bits-ui";

	import { cn, type WithoutChildrenOrChild } from "../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();
</script>

<ProgressPrimitive.Root
	bind:ref
	class={cn(
		"bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full",
		className,
	)}
	{value}
	{max}
	{...restProps}
>
	<div
		class="bg-primary size-full flex-1 transition-all"
		style="transform: translateX(-{100 - (100 * (value ?? 0)) / max}%)"
	></div>
</ProgressPrimitive.Root>
