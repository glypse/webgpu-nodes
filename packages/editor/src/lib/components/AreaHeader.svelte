<script lang="ts">
	import { EDITOR_TYPES, type EditorType } from "$core";
	import { Button, ContextMenu, DropdownMenu } from "$theme";
	import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
	import type { Snippet } from "svelte";

	import { getGraphManager } from "../graph-manager.svelte";
	import { EDITORS } from "./screen/editors";
	import { getScreenControls } from "./screen/screen-controls";

	let { areaId, children }: { areaId: string; children?: Snippet } = $props();

	const graph = getGraphManager();
	const screen = getScreenControls();

	const type = $derived<EditorType>(
		graph.screen.areas.find((a) => a.id === areaId)?.editor.type ?? "graph",
	);
	const Icon = $derived(EDITORS[type].icon);
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger
		class="bg-background flex h-9 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b px-1.5"
	>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="xs"
						class="text-muted-foreground shrink-0 gap-0.5 px-1.5"
						title="Editor type"
					>
						<Icon class="size-4" />
						<CaretDownIcon class="size-3" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-44">
				{#each EDITOR_TYPES as option (option)}
					{@const OptionIcon = EDITORS[option].icon}
					<DropdownMenu.Item
						onSelect={() => {
							screen.setEditorType(areaId, option);
						}}
					>
						<OptionIcon />
						{EDITORS[option].label}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		{@render children?.()}
	</ContextMenu.Trigger>
	<ContextMenu.Content class="w-52">
		<ContextMenu.Item onSelect={() => screen.split(areaId, "x")}
			>Vertical split</ContextMenu.Item
		>
		<ContextMenu.Item onSelect={() => screen.split(areaId, "y")}
			>Horizontal split</ContextMenu.Item
		>
		<ContextMenu.Separator />
		<ContextMenu.Item onSelect={() => screen.toggleMaximized(areaId)}>
			{screen.maximized === areaId ? "Restore area" : "Maximize area"}
			<ContextMenu.Shortcut>⌃Space</ContextMenu.Shortcut>
		</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item disabled={screen.areaCount < 2} onSelect={() => screen.close(areaId)}>
			Close area
		</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
