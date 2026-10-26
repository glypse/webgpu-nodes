<script lang="ts">
	import { type EnumVariant, enumValue } from "$core";
	import { Select } from "$theme";

	import type { ControlProps } from "./types";

	let {
		control,
		value,
		disabled,
		name,
		onchange,
	}: ControlProps<{ kind: "enum"; variants: readonly EnumVariant[] }> = $props();

	const selected = $derived(enumValue(value, control.variants));
</script>

<Select.Root
	type="single"
	{name}
	value={String(selected)}
	{disabled}
	onValueChange={(next: string) => {
		onchange(Number(next));
	}}
>
	<Select.Trigger class="w-full">
		{control.variants.find((v) => v.value === selected)?.label ?? ""}
	</Select.Trigger>
	<Select.Content>
		{#each control.variants as variant (variant.value)}
			<Select.Item value={String(variant.value)} label={variant.label}>
				{variant.label}
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
