<script lang="ts">
	import {
		DEFAULT_MAX_ITERATIONS,
		WGSL_TYPES,
		type WgslType,
		type ZoneItem,
		zoneMaxIterations,
	} from "$core";
	import { Button, DropdownMenu, Input, Scrubbable } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import TypePicker from "./TypePicker.svelte";

	const graph = getGraphManager();

	/** The zone's Repeat Input. */
	let { zoneId }: { zoneId: string } = $props();

	const items = $derived(graph.getZoneItems(zoneId));
	const inputNode = $derived(graph.resolveNode(zoneId));
	const maxIterations = $derived(
		inputNode ? zoneMaxIterations(inputNode) : DEFAULT_MAX_ITERATIONS,
	);
	const locked = $derived(graph.isLocked);
	/** The type variables of the group the zone is in, which its items may share. */
	const variables = $derived(graph.activeDocument.typeVariables);

	function variableOf(item: ZoneItem) {
		const type = item.type;
		return typeof type === "string" ? undefined : variables.find((v) => v.id === type.variable);
	}

	// Local buffer for label inputs: commit on blur so typing doesn't
	// regenerate the shader on every keystroke.
	const labelBuffer = $state<Record<string, string>>({});
	$effect(() => {
		for (const item of items) {
			if (!(item.id in labelBuffer)) labelBuffer[item.id] = item.label;
		}
	});

	function commitLabel(itemId: string) {
		const value = labelBuffer[itemId] ?? "";
		if (!graph.renameZoneItem(zoneId, itemId, value)) {
			const stored = items.find((i) => i.id === itemId)?.label;
			if (stored !== undefined) labelBuffer[itemId] = stored;
		}
	}

	function handleEnterBlur(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			(e.target as HTMLInputElement).blur();
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">Repeat zone</span>
		<span class="text-muted-foreground text-xs">
			Nodes linked from the Repeat Input run once per iteration. Each state item carries a
			value from one iteration to the next.
		</span>
	</div>
	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">Maximum iterations</span>
		<Scrubbable
			integer
			min={0}
			readonly={locked}
			value={maxIterations}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				graph.setZoneMaxIterations(zoneId, Number(e.currentTarget.value));
			}}
		/>
		<span class="text-muted-foreground text-xs">
			The iteration count is clamped to this value, so a large or animated count can't stall
			the GPU.
		</span>
	</div>

	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">State items</span>
		{#each items as item, i (item.id)}
			{@const shared = variableOf(item)}
			<div class="flex items-center gap-1">
				<Input
					value={labelBuffer[item.id] ?? item.label}
					disabled={locked}
					oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
						labelBuffer[item.id] = e.currentTarget.value;
					}}
					onblur={() => commitLabel(item.id)}
					onkeydown={handleEnterBlur}
				/>
				<TypePicker
					types={WGSL_TYPES}
					value={typeof item.type === "string" ? item.type : undefined}
					label={shared?.name}
					disabled={locked}
					class="w-24 shrink-0"
					title={shared ? `Shares the type ${shared.name}` : "Item type"}
					onpick={(type: WgslType) => {
						graph.setZoneItemType(zoneId, item.id, type);
					}}
				>
					{#snippet extra()}
						{#if variables.length > 0}
							<DropdownMenu.Label>Shared types</DropdownMenu.Label>
							{#each variables as variable (variable.id)}
								<DropdownMenu.Item
									onSelect={() => {
										graph.setZoneItemType(zoneId, item.id, {
											variable: variable.id,
										});
									}}
								>
									<span class="text-xs">{variable.name}</span>
									<CheckIcon
										class="ml-auto {shared?.id === variable.id
											? ''
											: 'invisible'}"
									/>
								</DropdownMenu.Item>
							{/each}
						{/if}
					{/snippet}
				</TypePicker>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Move up"
					disabled={locked || i === 0}
					onclick={() => graph.moveZoneItem(zoneId, item.id, -1)}
				>
					<ArrowUpIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Move down"
					disabled={locked || i === items.length - 1}
					onclick={() => graph.moveZoneItem(zoneId, item.id, 1)}
				>
					<ArrowDownIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Remove item"
					disabled={locked}
					onclick={() => graph.removeZoneItem(zoneId, item.id)}
				>
					<TrashIcon />
				</Button>
			</div>
		{/each}
		{#if !locked}
			<TypePicker
				types={WGSL_TYPES}
				label="Add item"
				onpick={(type: WgslType) => {
					graph.addZoneItem(zoneId, type);
				}}
			/>
		{/if}
	</div>
</div>
