<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

	import { cn } from "../../../utils.js";
	import { buttonVariants, type ButtonVariant, type ButtonSize } from "../button/index.js";

	let {
		ref = $bindable(null),
		class: className,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		variant = "default",
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		size = "default",
		...restProps
	}: AlertDialogPrimitive.ActionProps & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();
</script>

<AlertDialogPrimitive.Action
	bind:ref
	data-slot="alert-dialog-action"
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
	class={cn(buttonVariants({ variant, size }), "cn-alert-dialog-action", className)}
	{...restProps}
/>
