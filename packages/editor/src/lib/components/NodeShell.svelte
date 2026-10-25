<script lang="ts">
	import {
		inputControl,
		type InputValue,
		isZoneNodeType,
		NEW_ITEM_HANDLE,
		type NodeData,
		type NodeSetting,
		settingValue as storedSetting,
		typeKind,
		WGSL_TYPES,
		type WgslType,
	} from "$core";
	import { Button, Select } from "$theme";
	import { Handle, Position, useNodeConnections } from "@xyflow/svelte";
	import FadersIcon from "phosphor-svelte/lib/FadersIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import TreeViewIcon from "phosphor-svelte/lib/TreeViewIcon";
	import WarningIcon from "phosphor-svelte/lib/WarningIcon";

	import { getDocumentView } from "../document-view";
	import { getGraphManager } from "../graph-manager.svelte";
	import InputEditor from "./controls/InputEditor.svelte";
	import TypePicker from "./TypePicker.svelte";
	import ColorWidget from "./widgets/ColorWidget.svelte";

	let {
		id,
		type: nodeType,
	}: {
		id: string;
		type: string;
	} = $props();

	const graph = getGraphManager();
	const view = getDocumentView();

	const isLocked = $derived(view.locked);

	const fullNode = $derived(view.document.nodes.find((n) => n.id === id));
	const data: NodeData = $derived(fullNode?.data ?? {});
	const descriptor = $derived(fullNode ? graph.resolveDescriptor(fullNode) : undefined);

	const nodeLocked = $derived(fullNode?.group?.locked ?? false);

	const outdated = $derived(graph.outdatedLibraryVersion(id));
	const outdatedMessage = $derived(
		outdated?.archived
			? `Uses an older version of ${outdated.label}, kept as it was saved. Add a new ${outdated.label} node for the latest version.`
			: `Saved with an older version of ${outdated?.label ?? "this group"}, which isn't available: the latest version is used instead, so its links may not match.`,
	);

	const hiddenInputs = $derived(graph.hiddenInputs(id));
	const inputs = $derived(graph.resolveNodeInputs(id).filter((i) => !hiddenInputs.has(i.id)));
	const outputs = $derived(graph.resolveNodeOutputs(id));
	const label = $derived(descriptor?.label);

	const nodeLabels = $derived(graph.resolveNodeLabels(id));

	const sheetTargetId = $derived(
		nodeType === "node-group"
			? id
			: graph.path.length > 0
				? graph.path[graph.path.length - 1]
				: undefined,
	);

	const connections = useNodeConnections({ handleType: "target" });
	const connectedHandles = $derived(new Set(connections.current.map((c) => c.targetHandle)));

	const typeChoice = $derived(graph.typeChoice(id));

	function pickType(type: WgslType) {
		graph.setNodeType(id, type);
	}

	function resetType() {
		graph.setNodeType(id, undefined);
	}

	function settingValue(setting: NodeSetting): string {
		return storedSetting(data, setting);
	}

	function settingLabel(setting: NodeSetting): string {
		const value = settingValue(setting);
		return setting.options.find((o) => o.value === value)?.label ?? value;
	}

	function handleSettingSelect(setting: NodeSetting, value: string) {
		graph.setSetting(id, setting.key, value);
	}

	function resolvedInputType(inputDef: { id: string }): WgslType {
		return graph.resolveInputType(id, inputDef.id);
	}

	function handleStyle(type: WgslType): string {
		return `--handle-color: var(--color-${type})`;
	}

	const isZoneNode = $derived(isZoneNodeType(nodeType));
	/** The zone a boundary node belongs to (its Repeat Input id). */
	const zoneId = $derived(
		isZoneNode ? graph.zoneAnalysis(view.document).zoneOfBoundary.get(id) : undefined,
	);

	function addZoneItem(type: WgslType) {
		if (zoneId) graph.addZoneItem(zoneId, type);
	}

	function addHandle(type: WgslType) {
		graph.addHandle(id, type);
	}
</script>

{#snippet addHandleButton(onPick: (type: WgslType) => void = addHandle)}
	<TypePicker types={WGSL_TYPES} label="+" class="w-full" title="Add a value" onpick={onPick} />
{/snippet}

{#if nodeType === "reroute"}
	<!-- Just a handle: the output sits on top of the input, so dragging from the
	     dot starts a new link while links dropped on it reach the input. -->
	{@const rerouteType = resolvedInputType({ id: "in" })}
	<div class="reroute" title="Reroute ({rerouteType})">
		<Handle
			type="target"
			position={Position.Left}
			id="in"
			class="node-shell__handle reroute__handle kind-{typeKind(rerouteType)}"
			style={handleStyle(rerouteType)}
		/>
		<Handle
			type="source"
			position={Position.Right}
			id="out"
			class="node-shell__handle reroute__handle reroute__handle--out kind-{typeKind(
				rerouteType,
			)}"
			style={handleStyle(rerouteType)}
		/>
	</div>
{:else if descriptor}
	<div class="node-shell__label">
		{#if isZoneNode}
			<div class="flex items-center justify-between gap-2">
				<span>{label}</span>
				{#if zoneId}
					<Button
						variant="secondary"
						type="button"
						size="icon-sm"
						title="Open repeat zone settings"
						onclick={() => graph.openZoneSheet(id)}
					>
						<FadersIcon />
					</Button>
				{/if}
			</div>
			{#if !zoneId}
				<span class="text-destructive text-xs">Missing its paired node</span>
			{/if}
		{:else if outdated}
			<div class="flex items-center justify-between gap-2">
				<span>{label}</span>
				<span class="text-amber-500" title={outdatedMessage}>
					<WarningIcon class="size-4" weight="fill" />
				</span>
			</div>
		{:else}
			<span>{label}</span>
		{/if}
		{#if nodeType === "node-group"}
			<div class="flex items-stretch gap-1 pb-1 *:flex-1">
				<Button
					variant="secondary"
					type="button"
					size="icon-sm"
					title="Enter node group"
					onclick={() => graph.enterGroup(id)}
				>
					<TreeViewIcon class="size-4" />
				</Button>
				{#if nodeLocked}
					<Button
						variant="secondary"
						type="button"
						size="icon-sm"
						title="Locked group - clone & edit"
						onclick={() => graph.deepClone(id)}
					>
						<LockSimpleIcon />
					</Button>
				{/if}
				{#if sheetTargetId}
					<Button
						variant="secondary"
						type="button"
						size="icon-sm"
						title="Open group settings"
						onclick={() => graph.openGroupSheet(sheetTargetId)}
					>
						<FadersIcon />
					</Button>
				{/if}
			</div>
		{/if}
		{#if typeChoice}
			<div class="inline-flex gap-1 pb-1">
				<TypePicker
					types={typeChoice.types}
					value={typeChoice.inferable
						? typeChoice.forced
						: (typeChoice.forced ?? typeChoice.inferred)}
					inferred={typeChoice.inferable ? typeChoice.inferred : undefined}
					class="flex-1"
					title="Value type"
					onpick={pickType}
					onreset={resetType}
				/>
			</div>
		{/if}
		{#each descriptor.settings ?? [] as setting (setting.key)}
			<Select.Root
				type="single"
				name="{id}-{setting.key}"
				value={settingValue(setting)}
				disabled={isLocked}
				onValueChange={(value: string) => handleSettingSelect(setting, value)}
			>
				<Select.Trigger class="w-full" title={setting.label}>
					{settingLabel(setting)}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						<Select.Label>{setting.label}</Select.Label>
						{#each setting.options as option (option.value)}
							<Select.Item value={option.value} label={option.label}>
								{option.label}
							</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		{/each}
	</div>

	<div class="node-shell__body">
		<div class="node-shell__outputs">
			{#each outputs as outputDef (outputDef.id)}
				<div class="node-shell__row node-shell__row--right">
					<span class="node-shell__handle-label"
						>{nodeLabels.outputs[outputDef.id] ?? outputDef.label}: {outputDef.type}</span
					>
					<Handle
						type="source"
						position={Position.Right}
						id={outputDef.id}
						class="node-shell__handle kind-{typeKind(outputDef.type)}"
						style={handleStyle(outputDef.type)}
					/>
				</div>
			{/each}

			{#if nodeType === "group-input" && !isLocked}
				{@render addHandleButton()}
			{/if}

			{#if zoneId && !isLocked}
				<!-- Virtual socket: drag from here to create a state item typed after the target. -->
				<div class="node-shell__row node-shell__row--right">
					<span class="node-shell__handle-label opacity-60">new item</span>
					<Handle
						type="source"
						position={Position.Right}
						id={NEW_ITEM_HANDLE}
						class="node-shell__handle node-shell__handle--virtual"
					/>
				</div>
			{/if}
		</div>

		{#if descriptor.widget?.kind === "color"}
			<ColorWidget
				{id}
				widget={descriptor.widget}
				{data}
				inputs={descriptor.inputs}
				defaults={descriptor.defaultData.values}
				connected={connectedHandles}
				disabled={isLocked}
			/>
		{/if}

		<div class="node-shell__inputs">
			{#each inputs as inputDef (inputDef.id)}
				{@const effectiveType = resolvedInputType(inputDef)}
				{@const connected = connectedHandles.has(inputDef.id)}
				{@const inputLabel = nodeLabels.inputs[inputDef.id] ?? inputDef.label}
				<div class="node-shell__row">
					<Handle
						type="target"
						position={Position.Left}
						id={inputDef.id}
						class="node-shell__handle kind-{typeKind(effectiveType)} {inputDef.variadic
							? 'variadic'
							: ''}"
						style={handleStyle(effectiveType)}
					/>
					{#if inputDef.variadic}
						<div class="flex flex-col gap-0.5">
							<span class="node-shell__handle-label"
								>{inputLabel}: {effectiveType}</span
							>
						</div>
					{:else if connected}
						<span
							class="text-muted-foreground pointer-events-none shrink-0 pr-1 text-xs"
						>
							{inputLabel}: {effectiveType}
						</span>
					{:else if inputDef.fallback}
						<span class="node-shell__handle-label">
							{inputLabel}: {effectiveType}
							<span class="opacity-60">(default)</span>
						</span>
					{:else}
						{@const control = inputControl(inputDef, effectiveType)}
						<div class="flex flex-1 flex-col gap-0.5">
							<span class="node-shell__handle-label">
								{inputLabel}{control.kind === "enum" ? "" : `: ${effectiveType}`}
							</span>
							<InputEditor
								{control}
								type={effectiveType}
								value={data.values?.[inputDef.id] ??
									descriptor.defaultData.values?.[inputDef.id]}
								disabled={isLocked}
								name="{id}-{inputDef.id}"
								onchange={(value: InputValue) =>
									graph.setInputValue(id, inputDef.id, value)}
							/>
						</div>
					{/if}
				</div>
			{/each}

			{#if nodeType === "group-output" && !isLocked}
				{@render addHandleButton()}
			{/if}

			{#if zoneId && !isLocked}
				<!-- Virtual socket: drop a link here to create a state item typed after its source. -->
				<div class="node-shell__row">
					<Handle
						type="target"
						position={Position.Left}
						id={NEW_ITEM_HANDLE}
						class="node-shell__handle node-shell__handle--virtual"
					/>
					<span class="node-shell__handle-label opacity-60">new item</span>
				</div>
				{@render addHandleButton(addZoneItem)}
			{/if}
		</div>
	</div>
{:else}
	<div class="node-shell node-shell--unknown">
		Unknown node type: {nodeType}
	</div>
{/if}
