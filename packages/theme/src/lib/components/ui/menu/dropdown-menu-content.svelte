<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";
	import { menuContentClass } from "./menu.js";

	let {
		ref = $bindable(null),
		sideOffset = 4,
		align = "start",
		class: className,
		...restProps
	}: DropdownMenuPrimitive.ContentProps = $props();
</script>

<DropdownMenuPrimitive.Portal>
	<DropdownMenuPrimitive.Content
		bind:ref
		{sideOffset}
		{align}
		class={cn(menuContentClass, className)}
		{...restProps}
	/>
</DropdownMenuPrimitive.Portal>
