<script lang="ts">
	import { readComponent } from "$core";
	import { Select } from "$theme";

	import type { ControlProps } from "./types";

	let {
		control,
		value,
		disabled,
		name,
		onchange,
	}: ControlProps<{ kind: "enum"; options: readonly string[] }> = $props();

	const index = $derived(Math.trunc(readComponent(value, "_")));
</script>

<Select.Root
	type="single"
	{name}
	value={String(index)}
	{disabled}
	onValueChange={(next: string) => {
		onchange(Number(next));
	}}
>
	<Select.Trigger class="w-full">{control.options[index] ?? `#${String(index)}`}</Select.Trigger>
	<Select.Content>
		{#each control.options as option, i (option)}
			<Select.Item value={String(i)} label={option}>{option}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
