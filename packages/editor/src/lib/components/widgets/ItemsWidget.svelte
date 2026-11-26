<script lang="ts">
	import {
		mipsProblem,
		type NodeData,
		renderItemFormat,
		renderItemType,
		TEXTURE_FORMATS,
		WGSL_TYPES,
		type WgslType,
	} from "$core";
	import { Button, Input, Select } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import { SvelteMap } from "svelte/reactivity";

	import { getGraphManager } from "../../graph-manager.svelte";
	import TypePicker from "../TypePicker.svelte";

	let { id, data, disabled }: { id: string; data: NodeData; disabled: boolean } = $props();

	const graph = getGraphManager();
	// `data` changes with every edit of the items.
	const items = $derived(data.items ?? graph.getRenderItems(id));
	const problem = $derived(mipsProblem(data));

	// Names commit on blur, so typing doesn't regenerate the shader on every keystroke.
	// An entry is kept only while its field is being edited.
	const names = new SvelteMap<string, string>();

	function commit(itemId: string) {
		const name = names.get(itemId);
		names.delete(itemId);
		if (name !== undefined) graph.apply({ kind: "renameRenderItem", args: [id, itemId, name] });
	}
</script>

<div class="nodrag flex flex-col gap-2 px-2 py-1">
	{#each items as item, i (item.id)}
		<div class="flex flex-col gap-1">
			<div class="flex items-center gap-1">
				<Input
					class="min-w-0 flex-1"
					aria-label="Item name"
					value={names.get(item.id) ?? item.label}
					{disabled}
					oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
						names.set(item.id, e.currentTarget.value);
					}}
					onblur={() => {
						commit(item.id);
					}}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
					}}
				/>
				<Button
					variant="ghost"
					size="icon-xs"
					title="Move up"
					aria-label="Move up"
					disabled={disabled || i === 0}
					onclick={() => graph.apply({ kind: "moveRenderItem", args: [id, item.id, -1] })}
				>
					<ArrowUpIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					title="Move down"
					aria-label="Move down"
					disabled={disabled || i === items.length - 1}
					onclick={() => graph.apply({ kind: "moveRenderItem", args: [id, item.id, 1] })}
				>
					<ArrowDownIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					title="Remove item"
					aria-label="Remove item"
					disabled={disabled || items.length <= 1}
					onclick={() => graph.apply({ kind: "removeRenderItem", args: [id, item.id] })}
				>
					<TrashIcon />
				</Button>
			</div>
			<div class="flex flex-col gap-1">
				<TypePicker
					types={WGSL_TYPES}
					value={renderItemType(item)}
					{disabled}
					class="w-full"
					title="Item type"
					onpick={(type: WgslType) => {
						graph.apply({ kind: "setRenderItemType", args: [id, item.id, type] });
					}}
				/>
				<Select.Root
					type="single"
					name="{id}-{item.id}-format"
					value={renderItemFormat(item)}
					{disabled}
					onValueChange={(value: string) => {
						const format = TEXTURE_FORMATS.find((f) => f === value);
						if (format)
							graph.apply({
								kind: "setRenderItemFormat",
								args: [id, item.id, format],
							});
					}}
				>
					<Select.Trigger class="w-full" title="Format" aria-label="Format">
						{renderItemFormat(item)}
					</Select.Trigger>
					<Select.Content>
						{#each TEXTURE_FORMATS as format (format)}
							<Select.Item value={format} label={format}>{format}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	{/each}
	{#if problem}
		<span class="text-destructive text-xs">{problem}</span>
	{/if}
	<Button
		variant="ghost"
		size="xs"
		title="Add an item"
		{disabled}
		onclick={() => graph.apply({ kind: "addRenderItem", args: [id] })}
	>
		<PlusIcon /> Add item
	</Button>
</div>
