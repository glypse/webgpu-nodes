<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";

	import { cn, type WithElementRef, type WithoutChildren } from "../../../utils.js";
	import { Textarea } from "../textarea/index.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		...props
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<Textarea
	bind:ref
	data-slot="input-group-control"
	class={cn(
		"flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
		className,
	)}
	bind:value
	{...props}
/>
