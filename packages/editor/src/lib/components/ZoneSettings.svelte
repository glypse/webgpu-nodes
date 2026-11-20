<script lang="ts">
	import {
		DEFAULT_MAX_ITERATIONS,
		isInferredItem,
		type ItemSize,
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

	import { getGraphManager } from "../graph-manager.svelte";
	import TypePicker from "./TypePicker.svelte";

	const graph = getGraphManager();

	/** The zone's input node. */
	let { zoneId }: { zoneId: string } = $props();

	const simulation = $derived(graph.zoneKind(zoneId) === "simulation");
	/** What its items can be: a simulation keeps textures too. */
	const itemTypes = $derived(simulation ? SOCKET_TYPES : WGSL_TYPES);
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

	// Local buffer for label inputs: commit on blur so typing doesn't
	// regenerate the shader on every keystroke.
	/** The picker's value for the format an item's type decides. */
	const DEFAULT_FORMAT = "\0default";

	const labelBuffer = $state<Record<string, string>>({});
	$effect(() => {
		for (const item of items) {
			if (!(item.id in labelBuffer)) labelBuffer[item.id] = item.label;
		}
	});

	/** The picker's value for the canvas' size. */
	const CANVAS = "\0canvas";
	const DEFAULT_PIXELS = 256;

	function sizeKind(item: ZoneItem): "canvas" | "scale" | "pixels" {
		return item.size?.kind ?? "canvas";
	}

	function pickSizeKind(item: ZoneItem, kind: string) {
		if (kind === sizeKind(item)) return;
		let size: ItemSize | undefined;
		if (kind === "scale") size = { kind: "scale", scale: 1 };
		else if (kind === "pixels") {
			size = { kind: "pixels", width: DEFAULT_PIXELS, height: DEFAULT_PIXELS };
		}
		graph.setZoneItemSize(zoneId, item.id, size);
	}

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
	{#if simulation}
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
	{#if !simulation}
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
					value={labelBuffer[item.id] ?? item.label}
					disabled={locked}
					oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
						labelBuffer[item.id] = e.currentTarget.value;
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
						graph.setZoneItemType(zoneId, item.id, type);
					}}
				>
					{#snippet extra()}
						<DropdownMenu.Item
							onSelect={() => {
								graph.setZoneItemType(zoneId, item.id, { inferred: true });
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
				{#if simulation}
					<Select.Root
						type="single"
						name="{zoneId}-{item.id}-format"
						value={item.format ?? DEFAULT_FORMAT}
						disabled={locked}
						onValueChange={(value: string) => {
							const format = TEXTURE_FORMATS.find((f) => f === value);
							graph.setZoneItemFormat(zoneId, item.id, format);
						}}
					>
						<Select.Trigger class="w-28 shrink-0" title="Format it's kept in">
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
							pickSizeKind(item, value);
						}}
					>
						<Select.Trigger class="w-20 shrink-0" title="Size it's kept at">
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
			{#if simulation && item.size}
				<div class="flex items-center gap-1 pl-4">
					{#if item.size.kind === "scale"}
						{@const size = item.size}
						<Scrubbable
							min={0}
							readonly={locked}
							value={size.scale}
							title="Scale"
							oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
								graph.setZoneItemSize(zoneId, item.id, {
									...size,
									scale: Number(e.currentTarget.value),
								});
							}}
						/>
						<span class="text-muted-foreground shrink-0 text-xs">of</span>
						<Select.Root
							type="single"
							name="{zoneId}-{item.id}-of"
							value={size.of ?? CANVAS}
							disabled={locked}
							onValueChange={(value: string) => {
								graph.setZoneItemSize(
									zoneId,
									item.id,
									value === CANVAS
										? { kind: "scale", scale: size.scale }
										: { kind: "scale", scale: size.scale, of: value },
								);
							}}
						>
							<Select.Trigger
								class="w-28 shrink-0"
								title="What the scale is relative to"
							>
								{items.find((i) => i.id === size.of)?.label ?? "Canvas"}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value={CANVAS} label="Canvas">Canvas</Select.Item>
								{#each items.filter((i) => i.id !== item.id) as other (other.id)}
									<Select.Item value={other.id} label={other.label}>
										{other.label}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{:else}
						{@const size = item.size}
						<Scrubbable
							integer
							min={1}
							readonly={locked}
							value={size.width}
							title="Width in pixels"
							oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
								graph.setZoneItemSize(zoneId, item.id, {
									...size,
									width: Number(e.currentTarget.value),
								});
							}}
						/>
						<Scrubbable
							integer
							min={1}
							readonly={locked}
							value={size.height}
							title="Height in pixels"
							oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
								graph.setZoneItemSize(zoneId, item.id, {
									...size,
									height: Number(e.currentTarget.value),
								});
							}}
						/>
					{/if}
				</div>
			{/if}
		{/each}
		{#if !locked}
			<TypePicker
				types={itemTypes}
				label="Add item"
				onpick={(type: SocketType) => {
					graph.addZoneItem(zoneId, type);
				}}
			>
				{#snippet extra()}
					<DropdownMenu.Item
						onSelect={() => {
							graph.addZoneItem(zoneId, { inferred: true });
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
