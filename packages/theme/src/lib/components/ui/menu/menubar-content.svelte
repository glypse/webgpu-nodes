<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";
	import { menuContentClass } from "./menu.js";

	let {
		ref = $bindable(null),
		sideOffset = 8,
		alignOffset = -4,
		align = "start",
		class: className,
		...restProps
	}: MenubarPrimitive.ContentProps = $props();
</script>

<MenubarPrimitive.Portal>
	<MenubarPrimitive.Content
		bind:ref
		{sideOffset}
		{alignOffset}
		{align}
		class={cn(menuContentClass, className)}
		{...restProps}
	/>
</MenubarPrimitive.Portal>
