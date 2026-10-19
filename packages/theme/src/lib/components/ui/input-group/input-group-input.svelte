<script lang="ts">
	import type { ClassValue } from "clsx";
	import type { ComponentProps } from "svelte";

	import { cn } from "../../../utils.js";
	import { Input } from "../input/index.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		...props
	}: ComponentProps<typeof Input> = $props();
</script>

<Input
	bind:ref
	data-slot="input-group-control"
	class={cn(
		"flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
		// Typed by Input's props; the type-aware linter can't see through `.svelte` imports.
		className as ClassValue,
	)}
	bind:value
	{...props}
/>
