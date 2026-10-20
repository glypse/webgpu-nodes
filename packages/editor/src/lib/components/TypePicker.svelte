<script lang="ts">
	import { SCALAR_KINDS, type ScalarKind, typeComponents, typeKind, type WgslType } from "$core";
	import { Button, DropdownMenu } from "$theme";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";

	/**
	 * Pick a value type from a menu organised like the add menu: one submenu
	 * per scalar kind (float, integer, unsigned, boolean), each listing its
	 * scalar and vector widths.
	 */
	let {
		types,
		value,
		onpick,
		inferred,
		onreset,
		label,
		title,
		disabled = false,
		variant = "outline",
		class: className,
	}: {
		/** Selectable types. */
		types: readonly WgslType[];
		/** The current type, checked in the menu and shown on the button. */
		value?: WgslType;
		onpick: (type: WgslType) => void;
		/**
		 * The type inferred from the links. When given, the menu offers it as
		 * a first "inferred" option (picking it calls `onreset`), and the
		 * button shows it as "[type] (inferred)" while `value` is unset.
		 */
		inferred?: WgslType;
		onreset?: () => void;
		/** Button text; defaults to the current type. */
		label?: string;
		title?: string;
		disabled?: boolean;
		variant?: "outline" | "secondary" | "ghost" | "default";
		class?: string;
	} = $props();

	const KIND_LABELS: Record<ScalarKind, string> = {
		f32: "Float",
		i32: "Integer",
		u32: "Unsigned integer",
		bool: "Boolean",
	};
	const WIDTH_LABELS = ["", "Scalar", "Vector 2", "Vector 3", "Vector 4"];

	// Float first, as everywhere else types are listed.
	const KIND_ORDER: ScalarKind[] = ["f32", "i32", "u32", "bool"];

	const groups = $derived(
		KIND_ORDER.filter((kind) => SCALAR_KINDS.includes(kind)).flatMap((kind) => {
			const members = types
				.filter((t) => typeKind(t) === kind)
				.toSorted((a, b) => typeComponents(a) - typeComponents(b));
			return members.length > 0 ? [{ kind, label: KIND_LABELS[kind], types: members }] : [];
		}),
	);
</script>

{#snippet typeItem(type: WgslType)}
	<DropdownMenu.Item
		onSelect={() => {
			onpick(type);
		}}
	>
		<span class="font-mono text-xs">{type}</span>
		<span class="text-muted-foreground ml-auto text-xs">
			{WIDTH_LABELS[typeComponents(type)]}
		</span>
		<CheckIcon class={type === value ? "" : "invisible"} />
	</DropdownMenu.Item>
{/snippet}

<DropdownMenu.Root>
	<DropdownMenu.Trigger {disabled}>
		{#snippet child({ props })}
			<Button {...props} {variant} size="sm" class={className} {title}>
				{label ?? value ?? (inferred ? `${inferred} (inferred)` : "Type")}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-auto min-w-40">
		{#if inferred}
			<DropdownMenu.Item onSelect={() => onreset?.()}>
				<span class="font-mono text-xs">{inferred}</span>
				<span class="text-muted-foreground ml-auto text-xs">Inferred</span>
				<CheckIcon class={value === undefined ? "" : "invisible"} />
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
		{/if}
		{#if groups.length === 1}
			{#each groups[0]?.types ?? [] as type (type)}
				{@render typeItem(type)}
			{/each}
		{:else}
			{#each groups as group (group.kind)}
				{#if group.types.length === 1 && group.types[0]}
					{@render typeItem(group.types[0])}
				{:else}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger>
							{group.label}
							{#if value && typeKind(value) === group.kind}
								<span class="text-muted-foreground ml-auto pl-2 font-mono text-xs">
									{value}
								</span>
							{/if}
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent>
							{#each group.types as type (type)}
								{@render typeItem(type)}
							{/each}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}
			{/each}
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
