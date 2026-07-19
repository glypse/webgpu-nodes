<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";
	import { buttonVariants, type ButtonVariant, type ButtonSize } from "../button/index.js";

	let {
		ref = $bindable(null),
		class: className,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		variant = "outline",
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		size = "default",
		...restProps
	}: AlertDialogPrimitive.CancelProps & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();
</script>

<AlertDialogPrimitive.Cancel
	bind:ref
	data-slot="alert-dialog-cancel"
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
	class={cn(buttonVariants({ variant, size }), "cn-alert-dialog-cancel", className)}
	{...restProps}
/>
