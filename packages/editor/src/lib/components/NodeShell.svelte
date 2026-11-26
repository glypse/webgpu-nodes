<script lang="ts">
	import {
		type HandleType,
		inputControl,
		type InputValue,
		interfaceOf,
		isTexture,
		isZoneNodeType,
		keepsTextures,
		NEW_ITEM_HANDLE,
		type NodeData,
		type NodeSetting,
		settingValue as storedSetting,
		sideOf,
		SOCKET_TYPES,
		socketKind,
		type SocketType,
		WGSL_TYPES,
		zoneItems,
		zoneKindOf,
	} from "$core";
	import { Button, Select } from "$theme";
	import { Handle, Position, useNodeConnections, useUpdateNodeInternals } from "@xyflow/svelte";
	import EyeSlashIcon from "phosphor-svelte/lib/EyeSlashIcon";
	import FadersIcon from "phosphor-svelte/lib/FadersIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import TreeViewIcon from "phosphor-svelte/lib/TreeViewIcon";
	import WarningIcon from "phosphor-svelte/lib/WarningIcon";

	import { getDocumentView } from "../document-view";
	import { getGraphManager } from "../graph-manager.svelte";
	import TypePicker from "./TypePicker.svelte";
	import InputEditor from "./controls/InputEditor.svelte";
	import AssetWidget from "./widgets/AssetWidget.svelte";
	import CasesWidget from "./widgets/CasesWidget.svelte";
	import CodeWidget from "./widgets/CodeWidget.svelte";
	import ColorWidget from "./widgets/ColorWidget.svelte";
	import CurveWidget from "./widgets/CurveWidget.svelte";
	import ItemsWidget from "./widgets/ItemsWidget.svelte";
	import RampWidget from "./widgets/RampWidget.svelte";

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
	const missingFile = $derived(
		graph.missingAsset(id, (asset) => graph.assetFiles.get(asset) !== undefined),
	);
	const outdatedMessage = $derived(
		outdated?.archived
			? `Uses an older version of ${outdated.label}, kept as it was saved. Add a new ${outdated.label} node for the latest version.`
			: `Saved with an older version of ${outdated?.label ?? "this group"}, which isn't available: the latest version is used instead, so its links may not match.`,
	);

	const connections = useNodeConnections({ handleType: "target" });
	const connectedHandles = $derived(new Set(connections.current.map((c) => c.targetHandle)));
	const outgoing = useNodeConnections({ handleType: "source" });
	const linkedOutputs = $derived(new Set(outgoing.current.map((c) => c.sourceHandle)));

	/** On a Group Output: the outputs linked on another Group Output node. */
	const linkedElsewhere = $derived.by(() => {
		if (nodeType !== "group-output") return new Set<string>();
		const doc = view.document;
		return new Set(
			doc.nodes
				.filter((n) => n.type === "group-output" && n.id !== id)
				.flatMap((n) => (doc.edgesByTarget.get(n.id) ?? []).map((e) => e.targetHandle)),
		);
	});

	/** Only the linked sockets are shown (Ctrl+H). */
	const onlyLinked = $derived(data.hideUnlinked === true);
	const hiddenInputs = $derived(graph.hiddenInputs(id, view.path));
	const inputs = $derived(
		graph
			.resolveNodeInputs(id, view.path)
			.filter((i) => !hiddenInputs.has(i.id) && (!onlyLinked || connectedHandles.has(i.id))),
	);
	const outputs = $derived(
		graph
			.resolveNodeOutputs(id, view.path)
			.filter((o) => !onlyLinked || linkedOutputs.has(o.id)),
	);
	const label = $derived(graph.nodeLabel(id));

	const nodeLabels = $derived(graph.resolveNodeLabels(id));

	// Svelte Flow measures a node's handles only when the node is resized, so
	// a handle swapped for another in place (an enum showing another variant's
	// inputs) would stay unmeasured, and links to it undrawn.
	const updateNodeInternals = useUpdateNodeInternals();
	const handleIds = $derived(
		[
			...inputs.map((i) => i.id),
			...[...hiddenInputs].filter((i) => connectedHandles.has(i)),
			"|",
			...outputs.map((o) => o.id),
		].join(" "),
	);
	let measuredHandleIds: string | undefined;
	$effect(() => {
		if (measuredHandleIds !== undefined && measuredHandleIds !== handleIds) {
			updateNodeInternals(id);
		}
		measuredHandleIds = handleIds;
	});

	const typeChoice = $derived(graph.typeChoice(id, view.path));
	const variableChoices = $derived(
		nodeType === "node-group"
			? graph.variableChoices(id, view.path).filter((c) => c.variable.types.length > 1)
			: [],
	);

	function pickType(type: SocketType) {
		graph.apply({ kind: "setNodeType", args: [id, type] });
	}

	function resetType() {
		graph.apply({ kind: "setNodeType", args: [id, undefined] });
	}

	function settingValue(setting: NodeSetting): string {
		return storedSetting(data, setting);
	}

	function settingLabel(setting: NodeSetting): string {
		const value = settingValue(setting);
		return setting.options.find((o) => o.value === value)?.label ?? value;
	}

	function handleSettingSelect(setting: NodeSetting, value: string) {
		graph.apply({ kind: "setSetting", args: [id, setting.key, value] });
	}

	function resolvedInputType(inputDef: { id: string }): SocketType {
		return graph.resolveInputType(id, inputDef.id, view.path);
	}

	function handleStyle(type: SocketType): string {
		return `--handle-color: var(--color-${type})`;
	}

	const isZoneNode = $derived(isZoneNodeType(nodeType));
	/** The zone a boundary node belongs to (its input's id). */
	const zoneId = $derived(
		isZoneNode ? graph.zoneAnalysis(view.document).zoneOfBoundary.get(id) : undefined,
	);

	/**
	 * On a group's boundary node or a zone node: what decides the type of each
	 * socket not of a fixed type (its shared type, or "inferred"), by handle id.
	 */
	const sharedTypes: Record<string, string> = $derived.by(() => {
		const side = sideOf({ type: nodeType });
		const zoneOutput = zoneId && graph.zoneAnalysis(view.document).zones.get(zoneId)?.outputId;
		const handles: readonly { id: string; type?: HandleType }[] = side
			? interfaceOf(view.document, side)
			: zoneItems(view.document.nodesById.get(zoneOutput ?? ""));
		const variables = view.document.typeVariables;
		return Object.fromEntries(
			handles.flatMap((handle) => {
				const type = handle.type;
				if (type === undefined) return [[handle.id, "inferred"]];
				if (typeof type === "string") return [];
				const variable = variables.find((v) => v.id === type.variable);
				return variable ? [[handle.id, variable.name]] : [];
			}),
		);
	});

	/** What a zone's items can be: those kept in textures can be textures too. */
	const itemTypes = $derived(keepsTextures(zoneKindOf(nodeType)) ? SOCKET_TYPES : WGSL_TYPES);

	function addZoneItem(type: SocketType) {
		if (zoneId) graph.apply({ kind: "addZoneItem", args: [zoneId, type] });
	}

	function addHandle(type: SocketType) {
		graph.apply({ kind: "addBoundaryHandle", args: [id, type] });
	}

	/** Dotted underline of the label of an input that needs a frame value. */
	const frameLabel = "underline decoration-dotted decoration-muted-foreground underline-offset-2";
</script>

{#snippet addHandleButton(
	onPick: (type: SocketType) => void = addHandle,
	types: readonly SocketType[] = SOCKET_TYPES,
)}
	<TypePicker {types} label="+" class="w-full" title="Add a socket" onpick={onPick} />
{/snippet}

{#if nodeType === "reroute"}
	<!-- Just a handle: the output sits on top of the input, so dragging from the
	     dot starts a new link while links dropped on it reach the input. -->
	{@const rerouteType = resolvedInputType({ id: "in" })}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="reroute"
		title="{data.label ?? 'Reroute'} ({rerouteType}): double-click to name it"
		ondblclick={() => {
			view.activate();
			graph.openSheet(id);
		}}
	>
		{#if data.label !== undefined}
			<span class="reroute__label" class:reroute__label--named={data.hideLinks}>
				{data.label}
			</span>
		{/if}
		<Handle
			type="target"
			position={Position.Left}
			id="in"
			class="node-shell__handle reroute__handle kind-{socketKind(rerouteType)}"
			style={handleStyle(rerouteType)}
		/>
		<Handle
			type="source"
			position={Position.Right}
			id="out"
			class="node-shell__handle reroute__handle reroute__handle--out kind-{socketKind(
				rerouteType,
			)}"
			style={handleStyle(rerouteType)}
		/>
	</div>
{:else if descriptor}
	<div class="node-shell__label">
		<div class="flex items-center justify-between gap-2">
			<span class="truncate">{label}</span>
			<div class="flex shrink-0 items-center gap-1">
				{#if onlyLinked}
					<Button
						variant="ghost"
						type="button"
						size="icon-xs"
						title="Unlinked sockets hidden: show them (Ctrl+H)"
						disabled={isLocked}
						onclick={() => {
							view.activate();
							graph.apply({ kind: "toggleUnlinkedSockets", args: [[id]] });
						}}
					>
						<EyeSlashIcon />
					</Button>
				{/if}
				{#if outdated}
					<span class="text-amber-500" title={outdatedMessage}>
						<WarningIcon class="size-4" weight="fill" />
					</span>
				{/if}
				{#if missingFile}
					<span
						class="text-amber-500"
						title="Its file is missing: it reads a transparent image. Pick another one, or replace the asset's file in the Assets area."
					>
						<WarningIcon class="size-4" weight="fill" />
					</span>
				{/if}
				<Button
					variant="ghost"
					type="button"
					size="icon-xs"
					title="Node settings (N)"
					onclick={() => {
						view.activate();
						graph.openSheet(id);
					}}
				>
					<FadersIcon />
				</Button>
			</div>
		</div>
		{#if isZoneNode && !zoneId}
			<span class="text-destructive text-xs">Missing its paired node</span>
		{/if}
		{#if nodeType === "node-group"}
			<div class="flex items-stretch gap-1 pb-1 *:flex-1">
				<Button
					variant="secondary"
					type="button"
					size="icon-sm"
					title="Enter node group"
					onclick={() => {
						view.activate();
						graph.apply({ kind: "enterGroup", args: [id] });
					}}
				>
					<TreeViewIcon class="size-4" />
				</Button>
				{#if nodeLocked}
					<Button
						variant="secondary"
						type="button"
						size="icon-sm"
						title="Locked group - clone & edit"
						onclick={() => graph.apply({ kind: "deepClone", args: [id] })}
					>
						<LockSimpleIcon />
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
					disabled={isLocked}
					class="flex-1"
					title="Value type"
					onpick={pickType}
					onreset={resetType}
				/>
			</div>
		{/if}
		{#each variableChoices as choice (choice.variable.id)}
			<div class="flex items-center gap-1 pb-1">
				<span class="text-muted-foreground w-5 shrink-0 text-xs">
					{choice.variable.name}
				</span>
				<TypePicker
					types={choice.variable.types}
					value={choice.inferable ? choice.forced : (choice.forced ?? choice.type)}
					inferred={choice.inferable ? choice.inferred : undefined}
					disabled={isLocked}
					class="flex-1"
					title="The type of {choice.variable.name}"
					onpick={(type: SocketType) =>
						type !== "texture" &&
						graph.apply({
							kind: "setVariableType",
							args: [id, choice.variable.id, type],
						})}
					onreset={() =>
						graph.apply({
							kind: "setVariableType",
							args: [id, choice.variable.id, undefined],
						})}
				/>
			</div>
		{/each}
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
						>{nodeLabels.outputs[outputDef.id] ?? outputDef.label}: {outputDef.type}{#if sharedTypes[outputDef.id]}
							<span class="opacity-60">
								({sharedTypes[outputDef.id]})</span
							>{/if}</span
					>
					<Handle
						type="source"
						position={Position.Right}
						id={outputDef.id}
						class="node-shell__handle kind-{socketKind(outputDef.type)}"
						style={handleStyle(outputDef.type)}
					/>
				</div>
			{/each}

			{#if nodeType === "group-input" && !isLocked && !onlyLinked}
				{@render addHandleButton()}
			{/if}

			{#if zoneId && !isLocked && !onlyLinked}
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
		{:else if descriptor.widget?.kind === "curve"}
			<CurveWidget {id} curve={data.curve} disabled={isLocked} />
		{:else if descriptor.widget?.kind === "ramp"}
			<RampWidget
				{id}
				{data}
				defaults={descriptor.defaultData.values}
				connected={connectedHandles}
				disabled={isLocked}
			/>
		{:else if descriptor.widget?.kind === "code"}
			<CodeWidget {id} {data} disabled={isLocked} />
		{:else if descriptor.widget?.kind === "cases"}
			<CasesWidget {id} {data} disabled={isLocked} />
		{:else if descriptor.widget?.kind === "items"}
			<ItemsWidget {id} {data} disabled={isLocked} />
		{:else if descriptor.widget?.kind === "asset"}
			<AssetWidget {id} media={descriptor.widget.media} {data} disabled={isLocked} />
		{/if}

		<div class="node-shell__inputs">
			<!-- Linked inputs of variants not picked keep their link, undrawn,
			     for when one is picked again. -->
			{#each [...hiddenInputs].filter((i) => connectedHandles.has(i)) as inputId (inputId)}
				<Handle
					type="target"
					position={Position.Left}
					id={inputId}
					class="invisible"
					isConnectable={false}
				/>
			{/each}
			{#each inputs as inputDef (inputDef.id)}
				{@const effectiveType = resolvedInputType(inputDef)}
				{@const connected = connectedHandles.has(inputDef.id)}
				{@const inputLabel = nodeLabels.inputs[inputDef.id] ?? inputDef.label}
				{@const frameMark = inputDef.frame ? frameLabel : ""}
				{@const frameTitle = inputDef.frame
					? "Needs a value that's the same for the whole frame"
					: undefined}
				<div class="node-shell__row" title={frameTitle}>
					<Handle
						type="target"
						position={Position.Left}
						id={inputDef.id}
						class="node-shell__handle kind-{socketKind(
							effectiveType,
						)} {inputDef.variadic ? 'variadic' : ''}"
						style={handleStyle(effectiveType)}
					/>
					{#if inputDef.variadic}
						<div class="flex flex-col gap-0.5">
							<span class="node-shell__handle-label"
								>{inputLabel}: {effectiveType}</span
							>
						</div>
					{:else if linkedElsewhere.has(inputDef.id)}
						<span
							class="text-muted-foreground pointer-events-none shrink-0 pr-1 text-xs opacity-60"
							title="Linked on another Group Output node"
						>
							{inputLabel}: {effectiveType} (elsewhere)
						</span>
					{:else if connected}
						<span
							class="text-muted-foreground pointer-events-none shrink-0 pr-1 text-xs {frameMark}"
						>
							{inputLabel}: {effectiveType}
							{#if sharedTypes[inputDef.id]}
								<span class="opacity-60">({sharedTypes[inputDef.id]})</span>
							{/if}
						</span>
					{:else if inputDef.fallback}
						<span class="node-shell__handle-label {frameMark}">
							{inputLabel}: {effectiveType}
							<span class="opacity-60">(default)</span>
						</span>
					{:else if isTexture(effectiveType)}
						<span class="node-shell__handle-label {frameMark}">
							{inputLabel}: {effectiveType}
							<span class="opacity-60">(none)</span>
						</span>
					{:else}
						{@const control = inputControl(inputDef, effectiveType)}
						<div class="flex flex-1 flex-col gap-0.5">
							<span class="node-shell__handle-label {frameMark}">
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
									graph.apply({
										kind: "setInputValue",
										args: [id, inputDef.id, value],
									})}
							/>
						</div>
					{/if}
				</div>
			{/each}

			{#if nodeType === "group-output" && !isLocked && !onlyLinked}
				{@render addHandleButton()}
			{/if}

			{#if zoneId && !isLocked && !onlyLinked}
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
				{@render addHandleButton(addZoneItem, itemTypes)}
			{/if}
		</div>
	</div>
{:else}
	<div class="node-shell node-shell--unknown">
		Unknown node type: {nodeType}
	</div>
{/if}
