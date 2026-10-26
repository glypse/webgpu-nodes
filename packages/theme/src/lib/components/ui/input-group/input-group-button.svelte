<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	const inputGroupButtonVariants = tv({
		base: "gap-2 text-sm flex items-center shadow-none",
		variants: {
			size: {
				xs: "h-6 gap-1 rounded-[calc(var(--radius)_-_3px)] px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
				sm: "",
				"icon-xs": "size-6 rounded-[calc(var(--radius)_-_3px)] p-0 has-[>svg]:p-0",
				"icon-sm": "size-8 p-0 has-[>svg]:p-0",
			},
		},
		defaultVariants: {
			size: "xs",
		},
	});

	export type InputGroupButtonSize = VariantProps<typeof inputGroupButtonVariants>["size"];
</script>

<script lang="ts">
	import type { ClassValue } from "clsx";
	import type { ComponentProps, Snippet } from "svelte";

	import { cn } from "../../../utils.js";
	import { Button } from "../button/index.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		type = "button",
		variant = "ghost",
		size = "xs",
		...restProps
	}: Omit<ComponentProps<typeof Button>, "href" | "size"> & {
		size?: InputGroupButtonSize;
	} = $props();

	// Typed by Button's props; the type-aware linter can't see through `.svelte` imports.
	const classes = $derived(cn(inputGroupButtonVariants({ size }), className as ClassValue));
	const content = $derived(children as Snippet | undefined);
</script>

<Button bind:ref {type} data-size={size} {variant} class={classes} {...restProps}>
	{@render content?.()}
</Button>
