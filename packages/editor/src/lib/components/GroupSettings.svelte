<script lang="ts">
	import {
		boundType,
		canCompile,
		COLOR_DISPLAYS,
		type ColorDisplay,
		type EnumVariant,
		FLOAT_TYPES,
		type GroupHandleDef,
		groupInputDef,
		type GroupSide,
		type HandleType,
		type InputControl,
		inputControl,
		type InputOwner,
		type InputValue,
		isTexture,
		nextVariantValue,
		offeredFor,
		ownerExists,
		SOCKET_TYPES,
		type SocketType,
		TOGGLE_VARIANTS,
		TYPE_SETS,
		typeKind,
		typeSetOf,
		type TypeVariable,
		valueType,
		variantTypes,
		type WgslType,
	} from "$core";
	import { Button, Checkbox, DropdownMenu, Input, Scrubbable, Select, ToggleGroup } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import TypePicker from "./TypePicker.svelte";
	import TypeSetPicker from "./TypeSetPicker.svelte";
	import InputEditor from "./controls/InputEditor.svelte";

	const graph = getGraphManager();

	/** The group node whose definition is edited. */
	let { groupId }: { groupId: string } = $props();

	const sheetGroupNode = $derived(graph.resolveNode(groupId));
	const definitionRef = $derived(sheetGroupNode?.group?.definitionRef);
	const definition = $derived(
		definitionRef ? graph.project.definitions.get(definitionRef) : undefined,
	);
	const locked = $derived(sheetGroupNode?.group?.locked ?? true);
	const inputHandles = $derived(definition?.inputs ?? []);
	const variables = $derived(definition?.typeVariables ?? []);
	/** The variables something can depend on: a single type leaves nothing to tell apart. */
	const typedVariables = $derived(variables.filter((v) => v.types.length > 1));

	/** The value type a handle has where nothing decides it (see `boundType`). */
	function typeOf(handle: GroupHandleDef): WgslType {
		return valueType(boundType(handle.type, variables, {}) ?? "f32");
	}

	function variableOf(handle: GroupHandleDef): TypeVariable | undefined {
		const type = handle.type;
		if (typeof type === "string" || !("variable" in type)) return undefined;
		return variables.find((v) => v.id === type.variable);
	}

	/** How many sockets share a variable. */
	function socketCount(variable: TypeVariable): number {
		return [...inputHandles, ...outputHandles].filter((h) => variableOf(h)?.id === variable.id)
			.length;
	}

	function isInferred(handle: GroupHandleDef): boolean {
		return typeof handle.type === "object" && "inferred" in handle.type;
	}

	function setSocketType(side: GroupSide, handle: GroupHandleDef, type: HandleType) {
		if (definitionRef)
			graph.apply({ kind: "setHandleType", args: [definitionRef, side, handle.id, type] });
	}

	/** Share a new variable from the socket, allowing the types of its kind. */
	function shareNew(side: GroupSide, handle: GroupHandleDef) {
		if (!definitionRef) return;
		const kind = TYPE_SETS.slice(0, 4).find((set) => set.types.includes(typeOf(handle)));
		const variable = graph.apply({
			kind: "addTypeVariable",
			args: [definitionRef, kind?.types ?? FLOAT_TYPES],
		});
		if (variable) setSocketType(side, handle, { variable: variable.id });
	}
	const outputHandles = $derived(definition?.outputs ?? []);

	/** The inputs directly under a variant, or under none. */
	function inputsUnder(owner: InputOwner | undefined): GroupHandleDef[] {
		return inputHandles.filter((h) =>
			owner
				? h.owner?.enumId === owner.enumId && h.owner.value === owner.value
				: !ownerExists(inputHandles, h.owner),
		);
	}

	const NEW_ENUM: EnumVariant[] = [
		{ value: 0, label: "Option 1" },
		{ value: 1, label: "Option 2" },
	];

	function addInput(
		type: SocketType,
		owner: InputOwner | undefined,
		variants?: readonly EnumVariant[],
	) {
		if (!definitionRef) return;
		graph.apply({
			kind: "addHandle",
			args: [
				definitionRef,
				"input",
				type,
				{
					...(owner ? { owner } : {}),
					...(variants ? { variants: [...variants] } : {}),
				},
			],
		});
	}

	const NO_VARIABLE = "none";

	const DISPLAY_LABELS: Record<ColorDisplay | "numbers", string> = {
		numbers: "Numbers",
		swatch: "Colour swatch",
		wheel: "Colour wheel",
	};

	/** Input handles whose details are shown. */
	const expanded = $state<Record<string, boolean>>({});

	/** Whether a handle's details are shown: open by default where they depend on a type. */
	function isExpanded(handle: GroupHandleDef): boolean {
		return (
			expanded[handle.id] ??
			(handle.typeOwner !== undefined || handle.variantsBy !== undefined)
		);
	}

	// Local buffer for handle label inputs - keeps the input responsive while
	// the actual graph mutation is committed on blur to avoid triggering shader re-gen.
	const handleLabelBuffer = $state<Record<string, string>>({});

	// Initialise the buffer when the sheet opens or handles change,
	// so the template never mutates $state during evaluation.
	$effect(() => {
		for (const h of [...inputHandles, ...outputHandles]) {
			if (!(h.id in handleLabelBuffer)) handleLabelBuffer[h.id] = h.label;
		}
	});

	// Local buffer for the group label input - keeps the input responsive while
	// the actual graph mutation is debounced to avoid triggering shader re-gen.
	let groupLabelBuffer = $derived(definition?.label ?? "");
	const groupLabelInvalid = $derived(
		!locked &&
			groupLabelBuffer.trim() !== "" &&
			!graph.isLabelAvailable(groupLabelBuffer, definitionRef),
	);

	function commitGroupLabel() {
		if (groupLabelBuffer.trim()) {
			graph.apply({ kind: "setGroupLabel", args: [groupId, groupLabelBuffer] });
		}
	}

	function commitHandleLabel(side: GroupSide, handleId: string) {
		const value = handleLabelBuffer[handleId] ?? "";
		if (!definitionRef || !value.trim()) return;
		if (
			!graph.apply({ kind: "setHandleLabel", args: [definitionRef, side, handleId, value] })
		) {
			// Revert buffer to the stored label so the input reflects the actual value
			const handles = side === "input" ? inputHandles : outputHandles;
			const stored = handles.find((h) => h.id === handleId)?.label;
			if (stored) handleLabelBuffer[handleId] = stored;
		}
	}

	function handleEnterBlur(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			(e.target as HTMLInputElement).blur();
		}
	}

	function defaultControl(handle: GroupHandleDef): InputControl {
		return inputControl(groupInputDef(handle, variables), typeOf(handle));
	}

	function setVariants(handle: GroupHandleDef, variants: EnumVariant[] | undefined) {
		if (definitionRef)
			graph.apply({ kind: "setHandleVariants", args: [definitionRef, handle.id, variants] });
	}

	function addVariant(handle: GroupHandleDef) {
		const variants = handle.variants ?? [];
		const label = `Option ${String(variants.length + 1)}`;
		setVariants(handle, [...variants, { value: nextVariantValue(variants), label }]);
	}

	function moveVariant(handle: GroupHandleDef, index: number, by: number) {
		const variants = [...(handle.variants ?? [])];
		const [moved] = variants.splice(index, 1);
		if (!moved) return;
		variants.splice(index + by, 0, moved);
		setVariants(handle, variants);
	}

	function inputValue(e: Event): string {
		return (e.currentTarget as HTMLInputElement).value;
	}
</script>

{#snippet handleRow(handle: GroupHandleDef, side: GroupSide, removable: boolean)}
	<div class="flex items-center gap-2">
		{#if handle.variants}
			<span
				class="border-border text-muted-foreground flex h-8 w-20 shrink-0 items-center justify-center rounded-md border text-xs"
			>
				{handle.type === "bool" ? "Checkbox" : "Enum"}
			</span>
		{:else}
			{@const shared = variableOf(handle)}
			{@const inferred = isInferred(handle)}
			<TypePicker
				types={SOCKET_TYPES}
				value={typeof handle.type === "string" ? handle.type : undefined}
				label={shared?.name ?? (inferred ? "Inferred" : undefined)}
				disabled={locked}
				class="w-20 shrink-0"
				title={shared ? `Shares the type ${shared.name}` : "Value type"}
				onpick={(type: SocketType) => setSocketType(side, handle, type)}
			>
				{#snippet extra()}
					<DropdownMenu.Label>Shared types</DropdownMenu.Label>
					{#each variables as variable (variable.id)}
						<DropdownMenu.Item
							onSelect={() => setSocketType(side, handle, { variable: variable.id })}
						>
							<span class="text-xs">{variable.name}</span>
							<span class="text-muted-foreground ml-auto text-xs">
								{typeSetOf(variable.types)?.label ?? "Custom"}
							</span>
							<CheckIcon class={shared?.id === variable.id ? "" : "invisible"} />
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Item onSelect={() => shareNew(side, handle)}>
						New shared type
					</DropdownMenu.Item>
					{#if side === "output"}
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							onSelect={() => setSocketType(side, handle, { inferred: true })}
						>
							Inferred
							<span class="text-muted-foreground ml-auto text-xs"
								>What reaches it</span
							>
							<CheckIcon class={inferred ? "" : "invisible"} />
						</DropdownMenu.Item>
					{/if}
				{/snippet}
			</TypePicker>
		{/if}
		<Input
			value={handleLabelBuffer[handle.id] ?? handle.label}
			disabled={locked}
			oninput={(e: Event) => {
				handleLabelBuffer[handle.id] = inputValue(e);
			}}
			onblur={() => commitHandleLabel(side, handle.id)}
			onkeydown={handleEnterBlur}
		/>
		{#if side === "input" && !isTexture(handle.type)}
			<Button
				variant="ghost"
				size="icon-sm"
				class="shrink-0"
				title={isExpanded(handle) ? "Hide details" : "Show details"}
				onclick={() => {
					expanded[handle.id] = !isExpanded(handle);
				}}
			>
				{#if isExpanded(handle)}<CaretDownIcon />{:else}<CaretRightIcon />{/if}
			</Button>
		{/if}
		{#if !locked}
			<Button
				variant="ghost"
				size="icon-sm"
				class="shrink-0"
				title="Remove"
				disabled={!removable}
				onclick={() => {
					if (definitionRef)
						graph.apply({
							kind: "removeHandle",
							args: [definitionRef, side, handle.id],
						});
				}}
			>
				<TrashIcon />
			</Button>
		{/if}
	</div>
{/snippet}

<!-- Picks one of the variables something can depend on, or none. -->
{#snippet variableSelect(
	value: string | undefined,
	current: string,
	noneLabel: string,
	label: (name: string) => string,
	onpick: (variable: TypeVariable | undefined) => void,
)}
	<Select.Root
		type="single"
		value={value ?? NO_VARIABLE}
		disabled={locked}
		onValueChange={(id: string) => {
			onpick(variables.find((v) => v.id === id));
		}}
	>
		<Select.Trigger class="w-full">{current}</Select.Trigger>
		<Select.Content>
			<Select.Item value={NO_VARIABLE} label={noneLabel}>{noneLabel}</Select.Item>
			{#each typedVariables as variable (variable.id)}
				<Select.Item value={variable.id} label={label(variable.name)}>
					{label(variable.name)}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

<!-- The variants of an enum against the types its variable takes. -->
{#snippet variantGrid(handle: GroupHandleDef, variable: TypeVariable)}
	{@const variants = handle.variants ?? []}
	{@const types = variantTypes(handle, variable)}
	<div class="overflow-x-auto overflow-y-hidden pt-1">
		<table class="text-xs">
			<thead>
				<tr>
					<td></td>
					{#each types as type (type)}
						<th class="text-muted-foreground px-2 pb-1 font-normal">{type}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each variants as variant (variant.value)}
					<tr>
						<th class="max-w-32 truncate pr-2 text-left font-normal">
							{variant.label}
						</th>
						{#each types as type (type)}
							{@const offered = offeredFor(variant, type)}
							{@const last =
								offered && variants.filter((v) => offeredFor(v, type)).length === 1}
							<td class="px-2 py-1">
								<Checkbox
									class="mx-auto"
									checked={offered}
									disabled={locked || last}
									title={last ? `${type} needs a variant` : undefined}
									aria-label="{variant.label} for {type}"
									onCheckedChange={(checked: boolean) => {
										if (definitionRef) {
											graph.apply({
												kind: "setVariantOffered",
												args: [
													definitionRef,
													handle.id,
													variant.value,
													type,
													checked,
												],
											});
										}
									}}
								/>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#snippet inputDetails(handle: GroupHandleDef)}
	<div class="border-border ml-2 flex flex-col gap-3 border-l pb-2 pl-3">
		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs">Default value</span>
			<InputEditor
				control={defaultControl(handle)}
				type={typeOf(handle)}
				value={definition?.defaults[handle.id]}
				disabled={locked}
				name="group-default-{handle.id}"
				onchange={(value: InputValue) => {
					if (definitionRef) {
						graph.apply({
							kind: "setHandleDefault",
							args: [definitionRef, handle.id, value],
						});
					}
				}}
			/>
		</div>

		{#if typedVariables.length > 0}
			{@const owner = handle.typeOwner}
			{@const ownerVariable = variables.find((v) => v.id === owner?.variable)}
			<div class="flex flex-col gap-1">
				<span class="text-muted-foreground text-xs">Shown</span>
				{@render variableSelect(
					owner?.variable,
					ownerVariable ? `While ${ownerVariable.name} is` : "Always",
					"Always",
					(name) => `While ${name} is`,
					(variable) => {
						expanded[handle.id] = true;
						if (definitionRef) {
							graph.apply({
								kind: "setHandleTypeOwner",
								args: [
									definitionRef,
									handle.id,
									variable && {
										variable: variable.id,
										types: variable.types.slice(0, 1),
									},
								],
							});
						}
					},
				)}
				{#if owner && ownerVariable}
					<ToggleGroup.Root
						type="multiple"
						size="sm"
						disabled={locked}
						value={owner.types}
						onValueChange={(types: string[]) => {
							if (!definitionRef) return;
							graph.apply({
								kind: "setHandleTypeOwner",
								args: [
									definitionRef,
									handle.id,
									{
										variable: ownerVariable.id,
										types: ownerVariable.types.filter((t) => types.includes(t)),
									},
								],
							});
						}}
					>
						{#each ownerVariable.types as type (type)}
							<ToggleGroup.Item
								value={type}
								disabled={owner.types.length === 1 && owner.types[0] === type}
							>
								{type}
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				{/if}
			</div>
		{/if}

		{#if handle.variants && handle.type !== "bool" && typedVariables.length > 0}
			{@const by = variables.find((v) => v.id === handle.variantsBy)}
			<div class="flex flex-col gap-1">
				<span class="text-muted-foreground text-xs">Variants offered</span>
				{@render variableSelect(
					handle.variantsBy,
					by ? `By ${by.name}` : "All",
					"All",
					(name) => `By ${name}`,
					(variable) => {
						expanded[handle.id] = true;
						if (definitionRef) {
							graph.apply({
								kind: "setVariantsBy",
								args: [definitionRef, handle.id, variable?.id],
							});
						}
					},
				)}
				{#if by}
					{@render variantGrid(handle, by)}
				{/if}
			</div>
		{/if}

		{#if canCompile(handle)}
			<div class="flex flex-col gap-1">
				<label class="flex items-center gap-2 text-xs">
					<Checkbox
						checked={handle.compiled === true}
						disabled={locked}
						onCheckedChange={(checked: boolean) => {
							if (definitionRef) {
								graph.apply({
									kind: "setHandleCompiled",
									args: [definitionRef, handle.id, checked],
								});
							}
						}}
					/>
					Compile in
				</label>
				<span class="text-muted-foreground text-xs">
					Lets it pick among textures. Editing it recompiles the shader.
				</span>
			</div>
		{/if}

		{#if !handle.variants && !handle.display && typeKind(typeOf(handle)) !== "bool"}
			<div class="flex flex-col gap-1">
				<span class="text-muted-foreground text-xs">Range while edited</span>
				{#each ["min", "max"] as const as bound (bound)}
					{@const current = handle[bound]}
					{@const setBound = (value: number | undefined) => {
						if (!definitionRef) return;
						graph.apply({
							kind: "setHandleRange",
							args: [
								definitionRef,
								handle.id,
								{
									min: handle.min,
									max: handle.max,
									[bound]: value,
								},
							],
						});
					}}
					<div class="flex items-center gap-1">
						<span class="text-muted-foreground w-8 shrink-0 text-xs">
							{bound === "min" ? "Min" : "Max"}
						</span>
						{#if current === undefined}
							<Button
								variant="outline"
								size="sm"
								class="flex-1 border-dashed"
								disabled={locked}
								title={bound === "min" ? "Set a minimum" : "Set a maximum"}
								onclick={() => {
									setBound(bound === "min" ? 0 : 1);
								}}
							>
								None
							</Button>
						{:else}
							<Scrubbable
								value={current}
								readonly={locked}
								integer={typeKind(typeOf(handle)) !== "f32"}
								oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
									const next = parseFloat(e.currentTarget.value);
									if (Number.isFinite(next)) setBound(next);
								}}
							/>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon-sm"
									class="shrink-0"
									title={bound === "min" ? "No minimum" : "No maximum"}
									onclick={() => {
										setBound(undefined);
									}}
								>
									<XIcon />
								</Button>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if handle.type === "vec3f" || handle.type === "vec4f"}
			<div class="flex flex-col gap-1">
				<span class="text-muted-foreground text-xs">Edit as</span>
				<Select.Root
					type="single"
					value={handle.display ?? "numbers"}
					disabled={locked}
					onValueChange={(next: string) => {
						if (definitionRef) {
							graph.apply({
								kind: "setHandleDisplay",
								args: [
									definitionRef,
									handle.id,
									COLOR_DISPLAYS.find((d) => d === next),
								],
							});
						}
					}}
				>
					<Select.Trigger class="w-full">
						{DISPLAY_LABELS[handle.display ?? "numbers"]}
					</Select.Trigger>
					<Select.Content>
						{#each Object.entries(DISPLAY_LABELS) as [key, label] (key)}
							<Select.Item value={key} {label}>{label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet addInputPicker(owner: InputOwner | undefined)}
	<TypePicker
		types={SOCKET_TYPES}
		label="Add input"
		title="Add an input"
		variant={owner ? "ghost" : "outline"}
		onpick={(type: SocketType) => addInput(type, owner)}
		onpickenum={() => addInput("u32", owner, NEW_ENUM)}
		onpicktoggle={() => addInput("bool", owner, TOGGLE_VARIANTS)}
	/>
{/snippet}

{#snippet inputList(side: GroupSide, owner: InputOwner | undefined)}
	{#each inputsUnder(owner) as handle (handle.id)}
		{@render handleRow(handle, side, true)}
		{#if isExpanded(handle) && !isTexture(handle.type)}
			{@render inputDetails(handle)}
		{/if}
		{#if handle.variants}
			{@render variantTree(handle, side)}
		{/if}
	{/each}
{/snippet}

<!-- Each variant with the inputs group nodes show while it's picked. -->
{#snippet variantTree(handle: GroupHandleDef, side: GroupSide)}
	{@const variants = handle.variants ?? []}
	{@const fixed = locked || handle.type === "bool"}
	<div class="border-border ml-2 flex flex-col gap-2 border-l pl-3">
		{#each variants as variant, i (variant.value)}
			<div class="flex flex-col gap-1.5">
				<div class="flex items-center gap-1">
					<Input
						value={variant.label}
						disabled={fixed}
						class="h-7 font-medium"
						title="Variant name"
						onchange={(e: Event) => {
							const label = inputValue(e).trim();
							if (!label) return;
							setVariants(
								handle,
								variants.map((v) =>
									v.value === variant.value ? { ...v, label } : v,
								),
							);
						}}
						onkeydown={handleEnterBlur}
					/>
					{#if !fixed}
						<Button
							variant="ghost"
							size="icon-sm"
							title="Move up"
							disabled={i === 0}
							onclick={() => moveVariant(handle, i, -1)}
						>
							<ArrowUpIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							title="Move down"
							disabled={i === variants.length - 1}
							onclick={() => moveVariant(handle, i, 1)}
						>
							<ArrowDownIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							title="Remove variant and its inputs"
							disabled={variants.length <= 1}
							onclick={() =>
								setVariants(
									handle,
									variants.filter((v) => v.value !== variant.value),
								)}
						>
							<TrashIcon />
						</Button>
					{/if}
				</div>
				<div class="flex flex-col gap-1.5 pl-3">
					{@render inputList(side, { enumId: handle.id, value: variant.value })}
					{#if !locked}
						{@render addInputPicker({ enumId: handle.id, value: variant.value })}
					{/if}
				</div>
			</div>
		{/each}
		{#if !fixed}
			<Button variant="outline" size="sm" onclick={() => addVariant(handle)}>
				Add variant
			</Button>
		{/if}
	</div>
{/snippet}

{#if sheetGroupNode && definition}
	<div class="flex flex-col gap-4">
		<Button
			variant="outline"
			onclick={() => graph.apply({ kind: "deepClone", args: [groupId] })}>Clone & Edit</Button
		>

		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">Group name</span>
			<Input
				value={groupLabelBuffer}
				placeholder="Group name"
				disabled={locked}
				aria-invalid={groupLabelInvalid}
				oninput={(e: Event) => {
					groupLabelBuffer = inputValue(e);
				}}
				onblur={commitGroupLabel}
				onkeydown={handleEnterBlur}
			/>
		</div>

		{#if variables.length > 0 || !locked}
			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">Shared types</span>
				<span class="text-muted-foreground text-xs">
					Sockets sharing a type take the same one on each group node, inferred from
					what's linked to them or picked on the node.
				</span>
				{#each variables as variable (variable.id)}
					<div class="flex items-center gap-2">
						<Input
							value={variable.name}
							disabled={locked}
							class="w-16 shrink-0"
							title="Name"
							onchange={(e: Event) => {
								const name = inputValue(e).trim();
								if (name && definitionRef) {
									graph.apply({
										kind: "setTypeVariable",
										args: [
											definitionRef,
											variable.id,
											{
												name,
											},
										],
									});
								}
							}}
							onkeydown={handleEnterBlur}
						/>
						<TypeSetPicker
							types={variable.types}
							disabled={locked}
							class="min-w-0 flex-1"
							onchange={(types: readonly WgslType[]) => {
								if (definitionRef) {
									graph.apply({
										kind: "setTypeVariable",
										args: [definitionRef, variable.id, { types }],
									});
								}
							}}
						/>
						<span class="text-muted-foreground w-14 shrink-0 text-right text-xs">
							{socketCount(variable)}
							{socketCount(variable) === 1 ? "socket" : "sockets"}
						</span>
						{#if !locked}
							<Button
								variant="ghost"
								size="icon-sm"
								class="shrink-0"
								title="Remove: its sockets keep its first type"
								onclick={() => {
									if (definitionRef)
										graph.apply({
											kind: "removeTypeVariable",
											args: [definitionRef, variable.id],
										});
								}}
							>
								<TrashIcon />
							</Button>
						{/if}
					</div>
				{/each}
				{#if !locked}
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							if (definitionRef)
								graph.apply({
									kind: "addTypeVariable",
									args: [definitionRef, FLOAT_TYPES],
								});
						}}
					>
						Add shared type
					</Button>
				{/if}
			</div>
		{/if}

		{#if definitionRef}
			{@const ref = definitionRef}
			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">Inputs</span>
				{@render inputList("input", undefined)}
				{#if !locked}
					{@render addInputPicker(undefined)}
				{/if}
			</div>

			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">Outputs</span>
				{#each outputHandles as handle (handle.id)}
					{@render handleRow(handle, "output", outputHandles.length > 1)}
				{/each}
				{#if !locked}
					<TypePicker
						types={SOCKET_TYPES}
						label="Add output"
						title="Add an output"
						onpick={(type: SocketType) =>
							graph.apply({ kind: "addHandle", args: [ref, "output", type] })}
					>
						{#snippet extra()}
							<DropdownMenu.Item
								onSelect={() =>
									graph.apply({
										kind: "addHandle",
										args: [ref, "output", { inferred: true }],
									})}
							>
								Inferred
								<span class="text-muted-foreground ml-auto text-xs">
									What reaches it
								</span>
							</DropdownMenu.Item>
						{/snippet}
					</TypePicker>
				{/if}
			</div>
		{/if}
	</div>
{/if}
