<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	import { cn, type WithElementRef } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
	bind:this={ref}
	class={cn(
		"text-muted-foreground group-focus/menu-item:text-accent-foreground ml-auto text-xs tracking-widest",
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</span>
