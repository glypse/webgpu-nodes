<script lang="ts">
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import type { HTMLLiAttributes } from "svelte/elements";

	import { cn, type WithElementRef } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLLiAttributes> = $props();
</script>

<li
	bind:this={ref}
	data-slot="breadcrumb-separator"
	role="presentation"
	aria-hidden="true"
	class={cn("cn-breadcrumb-separator", className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<CaretRightIcon class="size-4" />
	{/if}
</li>
