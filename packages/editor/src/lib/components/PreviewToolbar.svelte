<script lang="ts">
	import { Button, DropdownMenu } from "$theme";
	import CaretUpDownIcon from "phosphor-svelte/lib/CaretUpDownIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";

	import { exportFrame } from "../exports";
	import { getGraphManager } from "../graph-manager.svelte";
	import type { PreviewView } from "../preview-view.svelte";
	import { getPreview } from "../preview.svelte";

	let { view }: { view: PreviewView } = $props();

	const graph = getGraphManager();
	const preview = getPreview();
	const resolution = $derived(view.resolution);

	const PERCENTAGES = [50, 100, 200, 400];
</script>

<div class="@container flex min-w-0 flex-1 items-center justify-end gap-1 text-xs">
	<Button
		variant="ghost"
		size="xs"
		class="text-muted-foreground hidden tabular-nums @[13rem]:inline-flex"
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

	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon-xs" title="Export">
					<DownloadSimpleIcon />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-48">
			<DropdownMenu.Item
				onSelect={() => {
					exportFrame(preview).catch((error: unknown) => {
						console.error("[export] frame export failed", error);
					});
				}}
			>
				Export frame as PNG
			</DropdownMenu.Item>
			<DropdownMenu.Item
				onSelect={() => {
					preview.exportDialogOpen = true;
				}}
			>
				Export video…
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
