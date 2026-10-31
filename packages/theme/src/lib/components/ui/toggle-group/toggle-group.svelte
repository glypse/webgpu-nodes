<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = "default",
		...restProps
	}: ToggleGroupPrimitive.RootProps & { size?: "default" | "sm" } = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<ToggleGroupPrimitive.Root
	bind:value={value as never}
	bind:ref
	data-size={size}
	class={cn("group/toggle-group flex w-fit items-center", className)}
	{...restProps}
/>
