<script lang="ts">
	import { TYPE_SETS, typeComponents, typeSetOf, type WgslType, withDefaultType } from "$core";
	import { Button, DropdownMenu } from "$theme";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";

	/**
	 * Pick the types a type variable may take: a named set, or any of them
	 * one by one, and which it takes when nothing decides.
	 */
	let {
		types,
		onchange,
		disabled = false,
		class: className,
	}: {
		types: readonly WgslType[];
		onchange: (types: readonly WgslType[]) => void;
		disabled?: boolean;
		class?: string;
	} = $props();

	const KINDS = TYPE_SETS.slice(0, 4);

	const set = $derived(typeSetOf(types));
	const defaultType = $derived(types[0]);
	const chosen = (kind: (typeof KINDS)[number]) => kind.types.filter((t) => types.includes(t));
	const byWidth = (list: readonly WgslType[]) =>
		list.toSorted((a, b) => typeComponents(a) - typeComponents(b));
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger {disabled}>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="justify-start {className ?? ''}"
				title="Types it may take"
			>
				<span class="truncate">{set?.label ?? types.join(", ")}</span>
				{#if set && set.types[0] !== defaultType}
					<span class="text-muted-foreground truncate text-xs">{defaultType}</span>
				{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-auto min-w-44">
		{#each TYPE_SETS as option (option.id)}
			<DropdownMenu.Item
				onSelect={() => {
					onchange(withDefaultType(option.types, defaultType));
				}}
			>
				{option.label}
				<CheckIcon class="ml-auto {set?.id === option.id ? '' : 'invisible'}" />
			</DropdownMenu.Item>
		{/each}
		<DropdownMenu.Separator />
		{#each KINDS as kind (kind.id)}
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger>
					{kind.label}
					{#if chosen(kind).length > 0}
						<span class="text-muted-foreground ml-auto pl-2 text-xs">
							{chosen(kind).length}
						</span>
					{/if}
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent>
					{#each byWidth(kind.types) as type (type)}
						{@const checked = types.includes(type)}
						<DropdownMenu.CheckboxItem
							{checked}
							closeOnSelect={false}
							disabled={checked && types.length === 1}
							onCheckedChange={(next: boolean) => {
								onchange(next ? [...types, type] : types.filter((t) => t !== type));
							}}
						>
							<span class="text-xs">{type}</span>
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
		{/each}
		<DropdownMenu.Separator />
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>
				Default
				<span class="text-muted-foreground ml-auto pl-2 text-xs">{defaultType}</span>
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent>
				{#each types as type (type)}
					<DropdownMenu.Item
						onSelect={() => {
							onchange(withDefaultType(types, type));
						}}
					>
						<span class="text-xs">{type}</span>
						<CheckIcon class="ml-auto {type === defaultType ? '' : 'invisible'}" />
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	</DropdownMenu.Content>
</DropdownMenu.Root>
