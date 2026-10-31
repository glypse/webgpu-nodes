<script lang="ts">
	import { DropdownMenu as MenuPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";
	import { menuContentClass } from "./menu.js";

	let {
		ref = $bindable(null),
		class: className,
		align = "start",
		alignOffset = -3,
		...restProps
	}: MenuPrimitive.SubContentProps = $props();
</script>

<MenuPrimitive.Portal>
	<MenuPrimitive.SubContent
		bind:ref
		{align}
		{alignOffset}
		class={cn(menuContentClass, className)}
		{...restProps}
	/>
</MenuPrimitive.Portal>
