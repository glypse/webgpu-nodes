<script lang="ts">
	import type { Size } from "$runtime";
	import { Button, DropdownMenu } from "$theme";
	import CaretUpDownIcon from "phosphor-svelte/lib/CaretUpDownIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import { getPreview } from "../preview.svelte";

	let { resolution }: { resolution: Size } = $props();

	const graph = getGraphManager();
	const view = getPreview().view;

	const PERCENTAGES = [50, 100, 200, 400];
</script>

<div class="bg-background flex h-9 shrink-0 items-center gap-1 border-t px-2 text-xs">
	<div class="flex-1"></div>

	<Button
		variant="ghost"
		size="xs"
		class="text-muted-foreground tabular-nums"
		title="Canvas settings"
		onclick={() => {
			graph.settingsPage = "canvas";
		}}
	>
		{resolution.width} × {resolution.height}
		{#if graph.settings.colorSpace === "display-p3"}
			<span class="bg-muted rounded px-1 text-[10px]">P3</span>
		{/if}
	</Button>

	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="xs"
					class="text-muted-foreground w-18 justify-between tabular-nums"
					title="Zoom"
				>
					{Math.round(view.zoom * 100)}%
					<CaretUpDownIcon />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-48">
			<DropdownMenu.Item onSelect={() => view.zoomIn()}>
				Zoom in
				<DropdownMenu.Shortcut>+</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => view.zoomOut()}>
				Zoom out
				<DropdownMenu.Shortcut>−</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => view.fit()}>
				Fit view
				<DropdownMenu.Shortcut>0</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => view.actualSize()}>
				Actual size
				<DropdownMenu.Shortcut>1</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			{#each PERCENTAGES as percentage (percentage)}
				<DropdownMenu.Item onSelect={() => view.zoomTo(percentage / 100)}>
					{percentage}%
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
