<script lang="ts">
	import { type NodeData, TEXTURE_FORMATS } from "$core";
	import { Button, Input, Select } from "$theme";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";

	import { getGraphManager } from "../../graph-manager.svelte";

	let { id, data, disabled }: { id: string; data: NodeData; disabled: boolean } = $props();

	const graph = getGraphManager();
	// `data` changes with every edit of the items.
	const items = $derived(data.items ?? graph.getRenderItems(id));

	// Names commit on blur, so typing doesn't regenerate the shader on every keystroke.
	const names = $state<Record<string, string>>({});

	function commit(itemId: string, stored: string) {
		const name = names[itemId] ?? stored;
		if (!graph.renameRenderItem(id, itemId, name)) names[itemId] = stored;
	}
</script>

<div class="nodrag flex flex-col gap-1 px-2 py-1">
	{#each items as item (item.id)}
		<div class="flex items-center gap-1">
			<Input
				class="min-w-0 flex-1"
				value={names[item.id] ?? item.label}
				{disabled}
				oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
					names[item.id] = e.currentTarget.value;
				}}
				onblur={() => {
					commit(item.id, item.label);
				}}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
				}}
			/>
			<Select.Root
				type="single"
				name="{id}-{item.id}-format"
				value={item.format ?? "rgba16float"}
				{disabled}
				onValueChange={(value: string) => {
					const format = TEXTURE_FORMATS.find((f) => f === value);
					if (format) graph.setRenderItemFormat(id, item.id, format);
				}}
			>
				<Select.Trigger class="w-28 shrink-0" title="Format">
					{item.format ?? "rgba16float"}
				</Select.Trigger>
				<Select.Content>
					{#each TEXTURE_FORMATS as format (format)}
						<Select.Item value={format} label={format}>{format}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button
				variant="ghost"
				size="icon-xs"
				title="Remove item"
				disabled={disabled || items.length <= 1}
				onclick={() => graph.removeRenderItem(id, item.id)}
			>
				<TrashIcon />
			</Button>
		</div>
	{/each}
	<Button
		variant="ghost"
		size="xs"
		title="Add an item"
		{disabled}
		onclick={() => graph.addRenderItem(id)}
	>
		<PlusIcon /> Add item
	</Button>
</div>
