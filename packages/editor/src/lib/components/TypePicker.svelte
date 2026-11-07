<script lang="ts" generics="T extends SocketType">
	import {
		isTexture,
		SCALAR_KINDS,
		type ScalarKind,
		type SocketType,
		typeComponents,
		typeKind,
		type WgslType,
	} from "$core";
	import { Button, DropdownMenu } from "$theme";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";
	import type { Snippet } from "svelte";

	/**
	 * Pick a socket type from a menu organised like the add menu: one submenu
	 * per scalar kind (float, integer, unsigned, boolean), each listing its
	 * scalar and vector widths, then Texture when offered.
	 */
	let {
		types,
		value,
		onpick,
		inferred,
		onreset,
		onpickenum,
		onpicktoggle,
		extra,
		label,
		title,
		disabled = false,
		variant = "outline",
		class: className,
	}: {
		/** Selectable types. */
		types: readonly T[];
		/** The current type, checked in the menu and shown on the button. */
		value?: T;
		onpick: (type: T) => void;
		/**
		 * The type inferred from the links. When given, the menu offers it as
		 * a first "inferred" option (picking it calls `onreset`), and the
		 * button shows it as "[type] (inferred)" while `value` is unset.
		 */
		inferred?: SocketType;
		onreset?: () => void;
		/** When given, the menu offers an enum first, picking it calls this. */
		onpickenum?: () => void;
		/** When given, the menu offers a checkbox with the enum, picking it calls this. */
		onpicktoggle?: () => void;
		/** Items listed first in the menu, before the types. */
		extra?: Snippet;
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

	const values = $derived(types.filter((t): t is T & WgslType => !isTexture(t)));
	const texture = $derived(types.find(isTexture));
	const groups = $derived(
		KIND_ORDER.filter((kind) => SCALAR_KINDS.includes(kind)).flatMap((kind) => {
			const members = values
				.filter((t) => typeKind(t) === kind)
				.toSorted((a, b) => typeComponents(a) - typeComponents(b));
			return members.length > 0 ? [{ kind, label: KIND_LABELS[kind], types: members }] : [];
		}),
	);
</script>

{#snippet textureItem(type: T)}
	<DropdownMenu.Item
		onSelect={() => {
			onpick(type);
		}}
	>
		<span class="text-xs">texture</span>
		<span class="text-muted-foreground ml-auto text-xs">Image</span>
		<CheckIcon class={value === "texture" ? "" : "invisible"} />
	</DropdownMenu.Item>
{/snippet}

{#snippet typeItem(type: T & WgslType)}
	<DropdownMenu.Item
		onSelect={() => {
			onpick(type);
		}}
	>
		<span class="text-xs">{type}</span>
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
		{#if extra}
			{@render extra()}
			<DropdownMenu.Separator />
		{/if}
		{#if onpickenum}
			<DropdownMenu.Item onSelect={() => onpickenum()}>
				Enum
				<span class="text-muted-foreground ml-auto text-xs">Variants</span>
			</DropdownMenu.Item>
			{#if onpicktoggle}
				<DropdownMenu.Item onSelect={() => onpicktoggle()}>
					Checkbox
					<span class="text-muted-foreground ml-auto text-xs">Off or on</span>
				</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Separator />
		{/if}
		{#if inferred}
			<DropdownMenu.Item onSelect={() => onreset?.()}>
				<span class="text-xs">{inferred}</span>
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
							{#if value && !isTexture(value) && typeKind(value) === group.kind}
								<span class="text-muted-foreground ml-auto pl-2 text-xs">
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
		{#if texture}
			{#if groups.length > 0}
				<DropdownMenu.Separator />
			{/if}
			{@render textureItem(texture)}
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
