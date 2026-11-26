<script lang="ts">
	import {
		DEFAULT_MAX_ITERATIONS,
		isInferredItem,
		keepsTextures,
		MAX_PASS_ITERATIONS,
		SOCKET_TYPES,
		type SocketType,
		TEXTURE_FORMATS,
		WGSL_TYPES,
		type ZoneItem,
		zoneMaxIterations,
	} from "$core";
	import { Button, DropdownMenu, Input, Scrubbable, Select } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import { SvelteMap } from "svelte/reactivity";

	import { getGraphManager } from "../graph-manager.svelte";
	import TypePicker from "./TypePicker.svelte";

	const graph = getGraphManager();

	/** The zone's input node. */
	let { zoneId }: { zoneId: string } = $props();

	const kind = $derived(graph.zoneKind(zoneId));
	/** Whether its items are kept in textures, with a format and a size. */
	const kept = $derived(keepsTextures(kind));
	const itemTypes = $derived(kept ? SOCKET_TYPES : WGSL_TYPES);
	/** The boundary node holding the item size inputs. */
	const sizeNode = $derived(kind === "passes" ? "Repeat Passes Output" : "Simulation Input");
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
		return typeof type === "object" && "variable" in type
			? variables.find((v) => v.id === type.variable)
			: undefined;
	}

	/** The picker's value for the format an item's type decides. */
	const DEFAULT_FORMAT = "\0default";

	// Label text being edited, by item. Committed on blur, so typing doesn't
	// regenerate the shader on every keystroke; an entry is kept only until then.
	const labelBuffer = new SvelteMap<string, string>();

	function sizeKind(item: ZoneItem): "canvas" | "scale" | "pixels" {
		return item.size ?? "canvas";
	}

	function commitLabel(itemId: string) {
		const value = labelBuffer.get(itemId);
		labelBuffer.delete(itemId);
		if (value !== undefined)
			graph.apply({ kind: "renameZoneItem", args: [zoneId, itemId, value] });
	}

	function handleEnterBlur(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			(e.target as HTMLInputElement).blur();
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if kind === "passes"}
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">Repeat Passes zone</span>
			<span class="text-muted-foreground text-xs">
				Repeats the passes that read an item or the iteration, as many times as the count
				says, within a frame. Each item is kept in a texture between iterations, whose size
				can change with every one. The count is clamped to {MAX_PASS_ITERATIONS}. Passes
				that read neither run once, before the loop.
			</span>
		</div>
	{:else if kind === "simulation"}
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">Simulation zone</span>
			<span class="text-muted-foreground text-xs">
				Nodes linked from the Simulation Input run once per frame, from the previous frame's
				state; each pixel keeps its own. A simulation starts from its initial values on the
				first frame, and whenever time goes back. A texture item keeps an image, which can
				be sampled anywhere.
			</span>
		</div>
	{:else}
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">Repeat zone</span>
			<span class="text-muted-foreground text-xs">
				Nodes linked from the Repeat Input run once per iteration. Each state item carries a
				value from one iteration to the next.
			</span>
		</div>
	{/if}
	{#if kind === "repeat"}
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">Maximum iterations</span>
			<Scrubbable
				integer
				min={0}
				readonly={locked}
				value={maxIterations}
				oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
					graph.apply({
						kind: "setZoneMaxIterations",
						args: [zoneId, Number(e.currentTarget.value)],
					});
				}}
			/>
			<span class="text-muted-foreground text-xs">
				The iteration count is clamped to this value, so a large or animated count can't
				stall the GPU.
			</span>
		</div>
	{/if}

	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">State items</span>
		{#each items as item, i (item.id)}
			{@const shared = variableOf(item)}
			{@const inferred = isInferredItem(item)}
			<div class="flex items-center gap-1">
				<Input
					aria-label="Item name"
					value={labelBuffer.get(item.id) ?? item.label}
					disabled={locked}
					oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
						labelBuffer.set(item.id, e.currentTarget.value);
					}}
					onblur={() => commitLabel(item.id)}
					onkeydown={handleEnterBlur}
				/>
				<TypePicker
					types={itemTypes}
					value={typeof item.type === "string" ? item.type : undefined}
					label={shared?.name ?? (inferred ? "Inferred" : undefined)}
					disabled={locked}
					class="w-24 shrink-0"
					title={shared
						? `Shares the type ${shared.name}`
						: inferred
							? "Takes the type of its initial value"
							: "Item type"}
					onpick={(type: SocketType) => {
						graph.apply({ kind: "setZoneItemType", args: [zoneId, item.id, type] });
					}}
				>
					{#snippet extra()}
						<DropdownMenu.Item
							onSelect={() => {
								graph.apply({
									kind: "setZoneItemType",
									args: [zoneId, item.id, { inferred: true }],
								});
							}}
						>
							Inferred
							<span class="text-muted-foreground ml-auto text-xs">Initial value</span>
							<CheckIcon class={inferred ? "" : "invisible"} />
						</DropdownMenu.Item>
						{#if variables.length > 0}
							<DropdownMenu.Separator />
							<DropdownMenu.Label>Shared types</DropdownMenu.Label>
							{#each variables as variable (variable.id)}
								<DropdownMenu.Item
									onSelect={() => {
										graph.apply({
											kind: "setZoneItemType",
											args: [
												zoneId,
												item.id,
												{
													variable: variable.id,
												},
											],
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
				{#if kept}
					<Select.Root
						type="single"
						name="{zoneId}-{item.id}-format"
						value={item.format ?? DEFAULT_FORMAT}
						disabled={locked}
						onValueChange={(value: string) => {
							const format = TEXTURE_FORMATS.find((f) => f === value);
							graph.apply({
								kind: "setZoneItemFormat",
								args: [zoneId, item.id, format],
							});
						}}
					>
						<Select.Trigger
							class="w-28 shrink-0"
							title="Format it's kept in"
							aria-label="Format"
						>
							{item.format ?? "Auto"}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={DEFAULT_FORMAT} label="Auto">Auto</Select.Item>
							{#each TEXTURE_FORMATS as format (format)}
								<Select.Item value={format} label={format}>{format}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Select.Root
						type="single"
						name="{zoneId}-{item.id}-size"
						value={sizeKind(item)}
						disabled={locked}
						onValueChange={(value: string) => {
							graph.apply({
								kind: "setZoneItemSize",
								args: [
									zoneId,
									item.id,
									value === "scale" || value === "pixels" ? value : undefined,
								],
							});
						}}
					>
						<Select.Trigger
							class="w-20 shrink-0"
							title="Size it's kept at: its scale and pixels are inputs of the {sizeNode}"
						>
							{sizeKind(item) === "canvas"
								? "Canvas"
								: sizeKind(item) === "scale"
									? "Scale"
									: "Pixels"}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="canvas" label="Canvas">Canvas</Select.Item>
							<Select.Item value="scale" label="Scale">Scale</Select.Item>
							<Select.Item value="pixels" label="Pixels">Pixels</Select.Item>
						</Select.Content>
					</Select.Root>
				{/if}
				<Button
					variant="ghost"
					size="icon-sm"
					title="Move up"
					aria-label="Move up"
					disabled={locked || i === 0}
					onclick={() =>
						graph.apply({ kind: "moveZoneItem", args: [zoneId, item.id, -1] })}
				>
					<ArrowUpIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Move down"
					aria-label="Move down"
					disabled={locked || i === items.length - 1}
					onclick={() =>
						graph.apply({ kind: "moveZoneItem", args: [zoneId, item.id, 1] })}
				>
					<ArrowDownIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Remove item"
					aria-label="Remove item"
					disabled={locked}
					onclick={() => graph.apply({ kind: "removeZoneItem", args: [zoneId, item.id] })}
				>
					<TrashIcon />
				</Button>
			</div>
		{/each}
		{#if !locked}
			<TypePicker
				types={itemTypes}
				label="Add item"
				onpick={(type: SocketType) => {
					graph.apply({ kind: "addZoneItem", args: [zoneId, type] });
				}}
			>
				{#snippet extra()}
					<DropdownMenu.Item
						onSelect={() => {
							graph.apply({
								kind: "addZoneItem",
								args: [zoneId, { inferred: true }],
							});
						}}
					>
						Inferred
						<span class="text-muted-foreground ml-auto text-xs">Initial value</span>
					</DropdownMenu.Item>
				{/snippet}
			</TypePicker>
		{/if}
	</div>
</div>
