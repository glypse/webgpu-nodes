<script lang="ts">
	import {
		COLOR_DISPLAYS,
		type ColorDisplay,
		boundType,
		type EnumVariant,
		groupInputDef,
		type GroupHandleDef,
		handlesOf,
		inputControl,
		type InputControl,
		type InputOwner,
		type InputValue,
		nextVariantValue,
		ownerExists,
		FLOAT_TYPES,
		type SocketType,
		TYPE_SETS,
		typeKind,
		type TypeVariable,
		WGSL_TYPES,
		type WgslType,
	} from "$core";
	import { Button, DropdownMenu, Input, Scrubbable, Select, Sheet } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import CheckIcon from "phosphor-svelte/lib/CheckIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import InputEditor from "./controls/InputEditor.svelte";
	import TypePicker from "./TypePicker.svelte";

	const graph = getGraphManager();

	const sheetGroupNode = $derived.by(() => {
		if (!graph.sheetGroupId) return undefined;
		if (graph.path.length > 0) {
			const inParent = graph.parentDocument.nodes.find((n) => n.id === graph.sheetGroupId);
			if (inParent) return inParent;
		}
		return graph.activeDocument.nodes.find((n) => n.id === graph.sheetGroupId);
	});
	const definitionRef = $derived(sheetGroupNode?.group?.definitionRef);
	const definition = $derived(
		definitionRef ? graph.project.definitions.get(definitionRef) : undefined,
	);
	const locked = $derived(sheetGroupNode?.group?.locked ?? true);
	const inputNode = $derived(definition?.nodes.find((n) => n.type === "group-input"));
	const outputNode = $derived(definition?.nodes.find((n) => n.type === "group-output"));
	const inputHandles = $derived(handlesOf(inputNode));
	const variables = $derived(definition?.typeVariables ?? []);

	/** The type a handle has where nothing decides it (see `boundType`). */
	function typeOf(handle: GroupHandleDef): WgslType {
		return boundType(handle.type, variables, {}) ?? "f32";
	}

	function variableOf(handle: GroupHandleDef): TypeVariable | undefined {
		const type = handle.type;
		if (typeof type === "string" || !("variable" in type)) return undefined;
		return variables.find((v) => v.id === type.variable);
	}

	/** The named set of types a variable takes, if it's one. */
	function setOf(variable: TypeVariable) {
		return TYPE_SETS.find(
			(set) =>
				set.types.length === variable.types.length &&
				set.types.every((t) => variable.types.includes(t)),
		);
	}

	/** How many sockets share a variable. */
	function socketCount(variable: TypeVariable): number {
		return [...inputHandles, ...outputHandles].filter((h) => variableOf(h)?.id === variable.id)
			.length;
	}

	function isInferred(handle: GroupHandleDef): boolean {
		return typeof handle.type === "object" && "inferred" in handle.type;
	}

	function setSocketType(nodeId: string, handle: GroupHandleDef, type: SocketType) {
		if (definitionRef) graph.setHandleType(definitionRef, nodeId, handle.id, type);
	}

	/** Share a new variable from the socket, allowing the types of its kind. */
	function shareNew(nodeId: string, handle: GroupHandleDef) {
		if (!definitionRef) return;
		const kind = TYPE_SETS.slice(0, 4).find((set) => set.types.includes(typeOf(handle)));
		const variable = graph.addTypeVariable(definitionRef, kind?.types ?? FLOAT_TYPES);
		if (variable) setSocketType(nodeId, handle, { variable: variable.id });
	}
	const outputHandles = $derived(handlesOf(outputNode));

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

	function addInput(type: WgslType, owner: InputOwner | undefined, enumInput = false) {
		if (!inputNode) return;
		graph.addHandle(inputNode.id, type, {
			...(owner ? { owner } : {}),
			...(enumInput ? { variants: NEW_ENUM } : {}),
		});
	}

	const DISPLAY_LABELS: Record<ColorDisplay | "numbers", string> = {
		numbers: "Numbers",
		swatch: "Colour swatch",
		wheel: "Colour wheel",
	};

	/** Input handles whose details are shown. */
	const expanded = $state<Record<string, boolean>>({});

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
		if (graph.sheetGroupId && groupLabelBuffer.trim()) {
			graph.setGroupLabel(graph.sheetGroupId, groupLabelBuffer);
		}
	}

	function commitHandleLabel(nodeId: string, handleId: string) {
		const value = handleLabelBuffer[handleId] ?? "";
		if (!definitionRef || !value.trim()) return;
		if (!graph.setHandleLabel(definitionRef, nodeId, handleId, value)) {
			// Revert buffer to the stored label so the input reflects the actual value
			const labels = graph.resolveNodeLabels(nodeId);
			const stored = labels.outputs[handleId] ?? labels.inputs[handleId];
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
		if (definitionRef && inputNode) {
			graph.setHandleVariants(definitionRef, inputNode.id, handle.id, variants);
		}
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

{#snippet handleRow(handle: GroupHandleDef, nodeId: string, removable: boolean)}
	<div class="flex items-center gap-2">
		{#if handle.variants}
			<span
				class="border-border text-muted-foreground flex h-8 w-20 shrink-0 items-center justify-center rounded-md border text-xs"
			>
				Enum
			</span>
		{:else}
			{@const shared = variableOf(handle)}
			{@const inferred = isInferred(handle)}
			<TypePicker
				types={WGSL_TYPES}
				value={typeof handle.type === "string" ? handle.type : undefined}
				label={shared?.name ?? (inferred ? "Inferred" : undefined)}
				disabled={locked}
				class="w-20 shrink-0 {shared ? 'font-mono' : ''}"
				title={shared ? `Shares the type ${shared.name}` : "Value type"}
				onpick={(type: WgslType) => setSocketType(nodeId, handle, type)}
			>
				{#snippet extra()}
					<DropdownMenu.Label>Shared types</DropdownMenu.Label>
					{#each variables as variable (variable.id)}
						<DropdownMenu.Item
							onSelect={() =>
								setSocketType(nodeId, handle, { variable: variable.id })}
						>
							<span class="font-mono text-xs">{variable.name}</span>
							<span class="text-muted-foreground ml-auto text-xs">
								{setOf(variable)?.label ?? "Custom"}
							</span>
							<CheckIcon class={shared?.id === variable.id ? "" : "invisible"} />
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Item onSelect={() => shareNew(nodeId, handle)}>
						New shared type
					</DropdownMenu.Item>
					{#if nodeId === outputNode?.id}
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							onSelect={() => setSocketType(nodeId, handle, { inferred: true })}
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
			onblur={() => commitHandleLabel(nodeId, handle.id)}
			onkeydown={handleEnterBlur}
		/>
		{#if nodeId === inputNode?.id}
			<Button
				variant="ghost"
				size="icon-sm"
				class="shrink-0"
				title={expanded[handle.id] ? "Hide details" : "Show details"}
				onclick={() => {
					expanded[handle.id] = !expanded[handle.id];
				}}
			>
				{#if expanded[handle.id]}<CaretDownIcon />{:else}<CaretRightIcon />{/if}
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
					if (definitionRef) graph.removeHandle(definitionRef, nodeId, handle.id);
				}}
			>
				<TrashIcon />
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet inputDetails(handle: GroupHandleDef)}
	<div class="border-border ml-2 flex flex-col gap-3 border-l pb-2 pl-3">
		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs">Default value</span>
			<InputEditor
				control={defaultControl(handle)}
				type={typeOf(handle)}
				value={inputNode?.data.values?.[handle.id]}
				disabled={locked}
				name="group-default-{handle.id}"
				onchange={(value: InputValue) => {
					if (definitionRef && inputNode) {
						graph.setHandleDefault(definitionRef, inputNode.id, handle.id, value);
					}
				}}
			/>
		</div>

		{#if !handle.variants && !handle.display && typeKind(typeOf(handle)) !== "bool"}
			<div class="flex flex-col gap-1">
				<span class="text-muted-foreground text-xs">Range while edited</span>
				{#each ["min", "max"] as const as bound (bound)}
					{@const current = handle[bound]}
					{@const setBound = (value: number | undefined) => {
						if (!definitionRef || !inputNode) return;
						graph.setHandleRange(definitionRef, inputNode.id, handle.id, {
							min: handle.min,
							max: handle.max,
							[bound]: value,
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
						if (definitionRef && inputNode) {
							graph.setHandleDisplay(
								definitionRef,
								inputNode.id,
								handle.id,
								COLOR_DISPLAYS.find((d) => d === next),
							);
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
		types={WGSL_TYPES}
		label="Add input"
		title="Add an input"
		variant={owner ? "ghost" : "outline"}
		onpick={(type: WgslType) => addInput(type, owner)}
		onpickenum={() => addInput("u32", owner, true)}
	/>
{/snippet}

{#snippet inputList(nodeId: string, owner: InputOwner | undefined)}
	{#each inputsUnder(owner) as handle (handle.id)}
		{@render handleRow(handle, nodeId, true)}
		{#if expanded[handle.id]}
			{@render inputDetails(handle)}
		{/if}
		{#if handle.variants}
			{@render variantTree(handle, nodeId)}
		{/if}
	{/each}
{/snippet}

<!-- Each variant with the inputs group nodes show while it's picked. -->
{#snippet variantTree(handle: GroupHandleDef, nodeId: string)}
	{@const variants = handle.variants ?? []}
	<div class="border-border ml-2 flex flex-col gap-2 border-l pl-3">
		{#each variants as variant, i (variant.value)}
			<div class="flex flex-col gap-1.5">
				<div class="flex items-center gap-1">
					<Input
						value={variant.label}
						disabled={locked}
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
					{#if !locked}
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
					{@render inputList(nodeId, { enumId: handle.id, value: variant.value })}
					{#if !locked}
						{@render addInputPicker({ enumId: handle.id, value: variant.value })}
					{/if}
				</div>
			</div>
		{/each}
		{#if !locked}
			<Button variant="outline" size="sm" onclick={() => addVariant(handle)}>
				Add variant
			</Button>
		{/if}
	</div>
{/snippet}

<Sheet.Root bind:open={graph.sheetOpen}>
	<Sheet.Content
		class="w-[350px] overflow-y-auto sm:w-[400px]"
		onOpenAutoFocus={(e: Event) => e.preventDefault()}
		escapeKeydownBehavior="ignore"
	>
		<Sheet.Header>
			<Sheet.Title>Group settings</Sheet.Title>
		</Sheet.Header>
		{#if sheetGroupNode && definition}
			<div class="flex flex-col gap-4 p-4">
				<Button
					variant="outline"
					onclick={() => {
						if (graph.sheetGroupId) {
							graph.deepClone(graph.sheetGroupId);
						}
					}}
				>
					Clone & Edit
				</Button>

				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">Group Label</span>
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
							Sockets sharing a type take the same one on each group node, inferred
							from what's linked to them or picked on the node.
						</span>
						{#each variables as variable (variable.id)}
							{@const set = setOf(variable)}
							<div class="flex items-center gap-2">
								<Input
									value={variable.name}
									disabled={locked}
									class="w-16 shrink-0 font-mono"
									title="Name"
									onchange={(e: Event) => {
										const name = inputValue(e).trim();
										if (name && definitionRef) {
											graph.setTypeVariable(definitionRef, variable.id, {
												name,
											});
										}
									}}
									onkeydown={handleEnterBlur}
								/>
								<Select.Root
									type="single"
									value={set?.id ?? ""}
									disabled={locked}
									onValueChange={(id: string) => {
										const picked = TYPE_SETS.find((s) => s.id === id);
										if (picked && definitionRef) {
											graph.setTypeVariable(definitionRef, variable.id, {
												types: picked.types,
											});
										}
									}}
								>
									<Select.Trigger
										class="min-w-0 flex-1"
										title="Types it may take"
									>
										{set?.label ?? "Custom"}
									</Select.Trigger>
									<Select.Content>
										{#each TYPE_SETS as option (option.id)}
											<Select.Item value={option.id} label={option.label}>
												{option.label}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<span
									class="text-muted-foreground w-14 shrink-0 text-right text-xs"
								>
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
												graph.removeTypeVariable(
													definitionRef,
													variable.id,
												);
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
										graph.addTypeVariable(definitionRef, FLOAT_TYPES);
								}}
							>
								Add shared type
							</Button>
						{/if}
					</div>
				{/if}

				{#if inputNode}
					{@const nodeId = inputNode.id}
					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">Inputs</span>
						{@render inputList(nodeId, undefined)}
						{#if !locked}
							{@render addInputPicker(undefined)}
						{/if}
					</div>
				{/if}

				{#if outputNode}
					{@const nodeId = outputNode.id}
					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">Outputs</span>
						{#each outputHandles as handle (handle.id)}
							{@render handleRow(handle, nodeId, outputHandles.length > 1)}
						{/each}
						{#if !locked}
							<TypePicker
								types={WGSL_TYPES}
								label="Add output"
								title="Add an output"
								onpick={(type: WgslType) => graph.addHandle(nodeId, type)}
							>
								{#snippet extra()}
									<DropdownMenu.Item
										onSelect={() => graph.addHandle(nodeId, { inferred: true })}
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
	</Sheet.Content>
</Sheet.Root>
