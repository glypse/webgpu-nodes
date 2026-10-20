<script lang="ts">
	import { Button, Checkbox, Scrubbable, Select } from "$theme";
	import { Handle, Position, useNodeConnections, useSvelteFlow } from "@xyflow/svelte";
	import FadersIcon from "phosphor-svelte/lib/FadersIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import TreeViewIcon from "phosphor-svelte/lib/TreeViewIcon";

	import { getGraphManager } from "./graph-state.svelte";
	import TypePicker from "./TypePicker.svelte";
	import {
		type HandleDef,
		type NodeSetting,
		type WgslType,
		WGSL_TYPES,
		isWgslType,
		typeComponents,
		typeKind,
	} from "./types";
	import { NEW_ITEM_HANDLE, isZoneNodeType } from "./zones";

	const VECTOR_KEYS = ["x", "y", "z", "w"];

	/** Keys of the per-component editors for a type ("_" for scalars). */
	function componentKeys(type: WgslType): string[] {
		const n = typeComponents(type);
		return n === 1 ? ["_"] : VECTOR_KEYS.slice(0, n);
	}

	let {
		id,
		data: rawData,
		type: nodeType,
	}: {
		id: string;
		data: Record<string, unknown>;
		type: string;
	} = $props();

	let data = $derived({ ...rawData });

	const { updateNodeData } = useSvelteFlow();
	const graph = getGraphManager();

	const isLocked = $derived(graph.isLocked);

	const fullNode = $derived(graph.activeDocument.nodes.find((n) => n.id === id));
	const descriptor = $derived(fullNode ? graph.resolveDescriptor(fullNode) : undefined);

	const nodeLocked = $derived(fullNode?.group?.locked ?? false);

	const inputs = $derived(graph.resolveNodeInputs(id));
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

	/** The input driving the node's type dropdown (and representative type). */
	const primaryInput = $derived(
		descriptor?.inputs.find((i) => i.id === descriptor.primaryInput) ?? descriptor?.inputs[0],
	);

	/** The types offered by the node's type dropdown. */
	const nodeTypes = $derived.by(() => {
		if (!descriptor) return undefined;
		if (descriptor.typeFamily) return descriptor.typeFamily.types;
		return primaryInput?.types;
	});

	/** The family key derived from nodeTypes. */
	const nodeFamilyKey = $derived.by(() => {
		if (descriptor?.typeFamily) return descriptor.typeFamily.key;
		return nodeTypes ? nodeTypes.join(",") : undefined;
	});

	/** Whether this node has a type family that supports multiple types. */
	const hasTypeDropdown = $derived(
		nodeTypes !== undefined && nodeTypes.length > 1 && nodeType !== "node-group",
	);

	/** Whether the type is inferable from connections (primary input has > 1 type). */
	const typeInferable = $derived((primaryInput?.types.length ?? 0) > 1);

	/** The user-forced type of the node's family, if any. */
	const forcedType = $derived.by((): WgslType | undefined => {
		if (!nodeFamilyKey) return undefined;
		const forced = descriptor?.typeFamily
			? data[descriptor.typeFamily.key]
			: (data.__nodeTypeOverrides as Record<string, unknown> | undefined)?.[nodeFamilyKey];
		return isWgslType(forced) ? forced : undefined;
	});

	/** The type the links would give the node, ignoring any forced type. */
	const inferredType = $derived.by((): WgslType => {
		if (descriptor?.typeFamily) return graph.resolveNodeOutputType(id);
		return primaryInput ? graph.resolveInferredInputType(id, primaryInput.id) : "f32";
	});

	/** The type shown in the dropdown: the forced type, or the resolved one. */
	const triggerLabel = $derived(forcedType ?? inferredType);

	function handleTypeSelect(value: WgslType) {
		if (!nodeFamilyKey) return;
		if (descriptor?.typeFamily) {
			updateNodeData(id, { ...data, [descriptor.typeFamily.key]: value });
			graph.invalidateTypes([id]);
			return;
		}
		const overrides = (data.__nodeTypeOverrides as Record<string, WgslType> | undefined) ?? {};
		updateNodeData(id, {
			...data,
			__nodeTypeOverrides: { ...overrides, [nodeFamilyKey]: value },
		});
		graph.invalidateTypes([id]);
	}

	function handleTypeReset() {
		if (!nodeFamilyKey) return;
		if (descriptor?.typeFamily) {
			const rest = { ...data };
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete rest[descriptor.typeFamily.key];
			updateNodeData(id, rest);
			graph.invalidateTypes([id]);
			return;
		}
		const overrides = (data.__nodeTypeOverrides as Record<string, WgslType> | undefined) ?? {};
		const rest = { ...overrides };
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete rest[nodeFamilyKey];
		updateNodeData(id, {
			...data,
			__nodeTypeOverrides: Object.keys(rest).length > 0 ? rest : undefined,
		});
		graph.invalidateTypes([id]);
	}

	function settingValue(setting: NodeSetting): string {
		const value = data[setting.key];
		const match = setting.options.find((o) => o.value === value);
		return (match ?? setting.options[0])?.value ?? "";
	}

	function settingLabel(setting: NodeSetting): string {
		const value = settingValue(setting);
		return setting.options.find((o) => o.value === value)?.label ?? value;
	}

	function handleSettingSelect(setting: NodeSetting, value: string) {
		updateNodeData(id, { ...data, [setting.key]: value });
		graph.invalidateTypes([id]);
	}

	function resolvedInputType(inputDef: { id: string }): WgslType {
		return graph.resolveInputType(id, inputDef.id);
	}

	/**
	 * Read one component of a stored input value. Vectors are stored as
	 * `{ x, y, ... }`; a plain scalar fills every component (codegen agrees).
	 */
	function getComponentValue(inputId: string, comp: string): number {
		const stored = data[inputId];
		if (stored && typeof stored === "object") {
			const raw = (stored as Record<string, unknown>)[comp === "_" ? "x" : comp];
			return typeof raw === "boolean" ? Number(raw) : Number(raw) || 0;
		}
		if (typeof stored === "boolean") return Number(stored);
		return Number(stored) || 0;
	}

	function setComponentValue(inputId: string, type: WgslType, comp: string, val: number) {
		if (typeComponents(type) === 1) {
			updateNodeData(id, { ...data, [inputId]: val });
			return;
		}
		const current = data[inputId];
		const obj: Record<string, unknown> =
			current && typeof current === "object"
				? { ...(current as Record<string, unknown>) }
				: Object.fromEntries(componentKeys(type).map((c) => [c, Number(current) || 0]));
		obj[comp] = val;
		updateNodeData(id, { ...data, [inputId]: obj });
	}

	function handleStyle(type: WgslType): string {
		return `--handle-color: var(--color-${type})`;
	}

	const isZoneNode = $derived(isZoneNodeType(nodeType));
	/** The zone a boundary node belongs to (its Repeat Input id). */
	const zoneId = $derived(isZoneNode ? graph.activeZones.zoneOfBoundary.get(id) : undefined);

	function addZoneItem(type: WgslType) {
		if (zoneId) graph.addZoneItem(zoneId, type);
	}

	function addHandle(type: WgslType) {
		const handles = (data.handles ?? []) as HandleDef[];
		const newHandle: HandleDef = {
			id: crypto.randomUUID(),
			label: `Handle ${String(handles.length + 1)}`,
			type,
		};
		updateNodeData(id, {
			...data,
			handles: [...handles, newHandle],
			[newHandle.id]: 0,
		});
		graph.invalidateTypes([id]);
	}
</script>

{#snippet addHandleButton(onPick: (type: WgslType) => void = addHandle)}
	<TypePicker types={WGSL_TYPES} label="+" class="w-full" title="Add a value" onpick={onPick} />
{/snippet}

{#snippet valueEditor(inputId: string, type: WgslType)}
	{@const kind = typeKind(type)}
	{#if kind === "bool"}
		<div class="flex items-center gap-2 py-1">
			{#each componentKeys(type) as comp (comp)}
				<label class="flex items-center gap-1 text-xs">
					<Checkbox
						class="nodrag"
						disabled={isLocked}
						checked={getComponentValue(inputId, comp) !== 0}
						onCheckedChange={(checked: boolean) => {
							setComponentValue(inputId, type, comp, checked ? 1 : 0);
						}}
					/>
					{#if comp !== "_"}<span class="text-muted-foreground">{comp}</span>{/if}
				</label>
			{/each}
		</div>
	{:else}
		<div class="*:not-first:rounded-t-none *:not-last:rounded-b-none">
			{#each componentKeys(type) as comp, i (comp)}
				<Scrubbable
					class={"node-shell__input" + (i > 0 ? "border-border border-t" : "")}
					readonly={isLocked}
					integer={kind !== "f32"}
					min={kind === "u32" ? 0 : undefined}
					value={getComponentValue(inputId, comp)}
					oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
						const val = parseFloat(e.currentTarget.value) || 0;
						setComponentValue(inputId, type, comp, val);
					}}
				/>
			{/each}
		</div>
	{/if}
{/snippet}

{#if descriptor}
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
		{#if hasTypeDropdown}
			<div class="inline-flex gap-1 pb-1">
				<TypePicker
					types={nodeTypes ?? []}
					value={typeInferable ? forcedType : triggerLabel}
					inferred={typeInferable ? inferredType : undefined}
					class="flex-1"
					title="Value type"
					onpick={handleTypeSelect}
					onreset={handleTypeReset}
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
					{:else}
						<div class="flex flex-1 flex-col gap-0.5">
							<span class="node-shell__handle-label"
								>{inputLabel}: {effectiveType}</span
							>
							{@render valueEditor(inputDef.id, effectiveType)}
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
