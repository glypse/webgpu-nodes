<script lang="ts">
	import DotsThreeIcon from "phosphor-svelte/lib/DotsThreeIcon";
	import type { HTMLAttributes } from "svelte/elements";

	import { cn, type WithElementRef, type WithoutChildren } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLSpanElement>>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="breadcrumb-ellipsis"
	role="presentation"
	aria-hidden="true"
	class={cn("cn-breadcrumb-ellipsis flex items-center justify-center", className)}
	{...restProps}
>
	<DotsThreeIcon class="size-4" />
	<span class="sr-only">More</span>
</span>
