<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";
	import { menuContentClass } from "./menu.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ContextMenuPrimitive.ContentProps = $props();
</script>

<ContextMenuPrimitive.Portal>
	<ContextMenuPrimitive.Content bind:ref class={cn(menuContentClass, className)} {...restProps} />
</ContextMenuPrimitive.Portal>
