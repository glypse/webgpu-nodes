<script lang="ts">
	import { Button, Input, Popover, Scrubbable, Select, Sheet } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";

	import { getGraphManager } from "./graph-state.svelte";
	import { type WgslType, WGSL_TYPES, isWgslType, typeKind } from "./types";
	import { DEFAULT_MAX_ITERATIONS, zoneMaxIterations } from "./zones";

	const graph = getGraphManager();

	/** The zone being edited, if it still exists in the viewed document. */
	const zoneId = $derived.by(() => {
		const id = graph.zoneSheetId;
		return id && graph.activeZones.zones.has(id) ? id : null;
	});
	const items = $derived(zoneId ? graph.getZoneItems(zoneId) : []);
	const inputNode = $derived(zoneId ? graph.activeDocument.nodesById.get(zoneId) : undefined);
	const maxIterations = $derived(
		inputNode ? zoneMaxIterations(inputNode) : DEFAULT_MAX_ITERATIONS,
	);
	const locked = $derived(graph.isLocked);

	let open = $derived(zoneId !== null);
	let addOpen = $state(false);

	const typeGroups = (() => {
		const groups: { kind: string; types: WgslType[] }[] = [];
		for (const t of WGSL_TYPES) {
			const kind = typeKind(t);
			const group = groups.find((g) => g.kind === kind);
			if (group) group.types.push(t);
			else groups.push({ kind, types: [t] });
		}
		return groups;
	})();

	// Local buffer for label inputs: commit on blur so typing doesn't
	// regenerate the shader on every keystroke.
	const labelBuffer = $state<Record<string, string>>({});
	$effect(() => {
		for (const item of items) {
			if (!(item.id in labelBuffer)) labelBuffer[item.id] = item.label;
		}
	});

	function commitLabel(itemId: string) {
		if (!zoneId) return;
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

<Sheet.Root
	{open}
	onOpenChange={(value: boolean) => {
		if (!value) graph.zoneSheetId = null;
	}}
>
	<Sheet.Content
		class="w-[350px] sm:w-[400px]"
		onOpenAutoFocus={(e: Event) => e.preventDefault()}
		escapeKeydownBehavior="ignore"
	>
		<Sheet.Header>
			<Sheet.Title>Repeat zone</Sheet.Title>
			<Sheet.Description>
				Nodes linked from the Repeat Input run once per iteration. Each state item carries a
				value from one iteration to the next.
			</Sheet.Description>
		</Sheet.Header>
		{#if zoneId}
			<div class="flex flex-col gap-4 p-4">
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">Maximum iterations</span>
					<Scrubbable
						integer
						min={0}
						readonly={locked}
						value={maxIterations}
						oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
							if (zoneId)
								graph.setZoneMaxIterations(zoneId, Number(e.currentTarget.value));
						}}
					/>
					<span class="text-muted-foreground text-xs">
						The iteration count is clamped to this value, so a large or animated count
						can't stall the GPU.
					</span>
				</div>

				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">State items</span>
					{#each items as item, i (item.id)}
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
							<Select.Root
								type="single"
								value={item.type}
								disabled={locked}
								onValueChange={(value: string) => {
									if (zoneId && isWgslType(value)) {
										graph.setZoneItemType(zoneId, item.id, value);
									}
								}}
							>
								<Select.Trigger class="w-24 shrink-0">{item.type}</Select.Trigger>
								<Select.Content>
									{#each typeGroups as group (group.kind)}
										<Select.Group>
											<Select.Label>{group.kind}</Select.Label>
											{#each group.types as t (t)}
												<Select.Item value={t} label={t}>{t}</Select.Item>
											{/each}
										</Select.Group>
									{/each}
								</Select.Content>
							</Select.Root>
							<Button
								variant="ghost"
								size="icon-sm"
								title="Move up"
								disabled={locked || i === 0}
								onclick={() => zoneId && graph.moveZoneItem(zoneId, item.id, -1)}
							>
								<ArrowUpIcon />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								title="Move down"
								disabled={locked || i === items.length - 1}
								onclick={() => zoneId && graph.moveZoneItem(zoneId, item.id, 1)}
							>
								<ArrowDownIcon />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								title="Remove item"
								disabled={locked}
								onclick={() => zoneId && graph.removeZoneItem(zoneId, item.id)}
							>
								<TrashIcon />
							</Button>
						</div>
					{/each}
					{#if !locked}
						<Popover.Root bind:open={addOpen}>
							<Popover.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline">Add item</Button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-auto p-1" sideOffset={4}>
								<div class="grid grid-cols-4 gap-0.5">
									{#each WGSL_TYPES as t (t)}
										<button
											class="hover:bg-accent rounded px-2 py-1 text-left text-xs"
											onclick={() => {
												if (zoneId) graph.addZoneItem(zoneId, t);
												addOpen = false;
											}}
										>
											{t}
										</button>
									{/each}
								</div>
							</Popover.Content>
						</Popover.Root>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
