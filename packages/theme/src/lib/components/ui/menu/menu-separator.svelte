<script lang="ts">
	import { DropdownMenu as MenuPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenuPrimitive.SeparatorProps = $props();
</script>

<MenuPrimitive.Separator
	bind:ref
	class={cn("bg-border -mx-1 my-1 h-px", className)}
	{...restProps}
/>
