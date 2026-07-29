<script lang="ts">
	import { Button, Popover, Scrubbable, Select } from "$theme";
	import { Handle, Position, useNodeConnections, useSvelteFlow } from "@xyflow/svelte";
	import ArrowUUpLeftIcon from "phosphor-svelte/lib/ArrowUUpLeftIcon";
	import FadersIcon from "phosphor-svelte/lib/FadersIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import TreeViewIcon from "phosphor-svelte/lib/TreeViewIcon";

	import { getGraphManager } from "./graph-state.svelte";
	import { type HandleDef, type WgslType, WGSL_TYPES } from "./types";

	const COMPONENT_KEYS: Record<WgslType, string[]> = {
		f32: ["_"],
		vec2f: ["x", "y"],
		vec3f: ["x", "y", "z"],
		vec4f: ["x", "y", "z", "w"],
	};

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

	const sheetTargetId = $derived(
		nodeType === "node-group"
			? id
			: graph.path.length > 0
				? graph.path[graph.path.length - 1]
				: undefined,
	);

	const connections = useNodeConnections({ handleType: "target" });
	const connectedHandles = $derived(new Set(connections.current.map((c) => c.targetHandle)));

	let popoverOpen = $state(false);

	/** The first input's types array, used as the node's type family key. */
	const nodeTypes = $derived.by(() => {
		if (!descriptor) return undefined;
		if (descriptor.typeFamily) return descriptor.typeFamily.types;
		if (descriptor.inputs.length === 0) return undefined;
		return descriptor.inputs[0]?.types;
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

	/** Whether the type is inferable from connections (first input has > 1 type). */
	const typeInferable = $derived(
		descriptor !== undefined &&
			descriptor.inputs.length > 0 &&
			(descriptor.inputs[0]?.types.length ?? 0) > 1,
	);

	/** Whether the node's type family is in forced (manual override) mode. */
	const isForced = $derived.by(() => {
		if (!nodeFamilyKey) return false;
		if (descriptor?.typeFamily) {
			return (data[descriptor.typeFamily.key] as WgslType | undefined) !== undefined;
		}
		return graph.isNodeForced(id, nodeFamilyKey);
	});

	/** The resolved type to display in the dropdown. */
	const resolvedType = $derived.by(() => {
		if (!descriptor || descriptor.inputs.length === 0) return "f32";
		const first = descriptor.inputs[0];
		if (!first) return "f32";
		return graph.resolveInputType(id, first.id);
	});

	/** The override type if forced, otherwise the resolved type. */
	const triggerLabel = $derived.by(() => {
		if (isForced && nodeFamilyKey) {
			if (descriptor?.typeFamily) {
				return (data[descriptor.typeFamily.key] as WgslType | undefined) ?? resolvedType;
			}
			const overrides = data.__nodeTypeOverrides as Record<string, WgslType> | undefined;
			return overrides?.[nodeFamilyKey] ?? resolvedType;
		}
		return resolvedType;
	});

	/** All types in the node's family (for the dropdown). */
	const familyTypes = $derived(nodeTypes ?? []);

	function handleTypeSelect(value: string) {
		if (!nodeFamilyKey) return;
		if (descriptor?.typeFamily) {
			updateNodeData(id, { ...data, [descriptor.typeFamily.key]: value });
			graph.invalidateTypes([id]);
			return;
		}
		graph.setNodeTypeOverride(id, nodeFamilyKey, value as WgslType);
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
		graph.clearNodeTypeOverride(id, nodeFamilyKey);
	}

	function resolvedInputType(inputDef: { id: string }): WgslType {
		return graph.resolveInputType(id, inputDef.id);
	}

	/** The resolved output type — reads from the TypeResolver cache (single source of truth). */
	const resolvedOutputType = $derived(graph.resolveNodeOutputType(id));

	function getComponentValue(inputId: string, type: WgslType, comp: string): number {
		if (type === "f32") return (data[inputId] as number | undefined) ?? 0;
		const obj = data[inputId];
		if (obj && typeof obj === "object" && comp in (obj as Record<string, unknown>)) {
			return Number((obj as Record<string, unknown>)[comp]) || 0;
		}
		return 0;
	}

	function setComponentValue(inputId: string, type: WgslType, comp: string, val: number) {
		if (type === "f32") {
			updateNodeData(id, { ...data, [inputId]: val });
		} else {
			const current = data[inputId];
			const obj =
				current && typeof current === "object"
					? { ...(current as Record<string, unknown>) }
					: {};
			obj[comp] = val;
			updateNodeData(id, { ...data, [inputId]: obj });
		}
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
		popoverOpen = false;
	}
</script>

{#snippet addHandleButton()}
	<Popover.Root bind:open={popoverOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} class="w-full">+</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-auto p-1" sideOffset={4} side="top">
			<div class="flex flex-col">
				{#each WGSL_TYPES as t (t)}
					<button
						class="hover:bg-accent rounded px-2 py-1 text-left text-xs"
						onclick={() => addHandle(t)}
					>
						{t}
					</button>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>
{/snippet}

{#if descriptor}
	<div class="node-shell__label">
		<span>{label}</span>
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
				<Select.Root
					type="single"
					name="{id}-node-type"
					value={triggerLabel}
					onValueChange={handleTypeSelect}
				>
					<Select.Trigger class="flex-1">
						{triggerLabel}
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							<Select.Label>Types</Select.Label>
							{#each familyTypes as t (t)}
								<Select.Item value={t} label={t}>
									{t}
								</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
				{#if isForced && typeInferable}
					<Button
						variant="secondary"
						type="button"
						title="Reset to dynamic inference"
						onclick={handleTypeReset}
					>
						<ArrowUUpLeftIcon class="size-3" />
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="node-shell__body">
		<div class="node-shell__outputs">
			{#each outputs as outputDef (outputDef.id)}
				{@const handleOutputType =
					nodeType === "group-input" || nodeType === "node-group"
						? outputDef.type
						: resolvedOutputType}
				<div class="node-shell__row node-shell__row--right">
					<span class="node-shell__handle-label"
						>{outputDef.label}: {handleOutputType}</span
					>
					<Handle
						type="source"
						position={Position.Right}
						id={outputDef.id}
						class="node-shell__handle {handleOutputType}"
					/>
				</div>
			{/each}

			{#if nodeType === "group-input" && !isLocked}
				{@render addHandleButton()}
			{/if}
		</div>

		<div class="node-shell__inputs">
			{#each inputs as inputDef (inputDef.id)}
				{@const effectiveType = resolvedInputType(inputDef)}
				{@const connected = connectedHandles.has(inputDef.id)}
				<div class="node-shell__row">
					<Handle
						type="target"
						position={Position.Left}
						id={inputDef.id}
						class="node-shell__handle {effectiveType} {inputDef.variadic
							? 'variadic'
							: ''}"
					/>
					{#if inputDef.variadic}
						<div class="flex flex-col gap-0.5">
							<span class="node-shell__handle-label"
								>{inputDef.label}: {effectiveType}</span
							>
						</div>
					{:else if connected}
						<span
							class="text-muted-foreground pointer-events-none shrink-0 pr-1 text-xs"
						>
							{inputDef.label}: {effectiveType}
						</span>
					{:else}
						<div class="flex flex-1 flex-col gap-0.5">
							<span class="node-shell__handle-label"
								>{inputDef.label}: {effectiveType}</span
							>
							<div class="*:not-first:rounded-t-none *:not-last:rounded-b-none">
								{#each COMPONENT_KEYS[effectiveType] as comp, i (comp)}
									<Scrubbable
										class={"node-shell__input" +
											(i > 0
												? "border-border border-foreground/15 border-t"
												: "")}
										readonly={isLocked}
										value={getComponentValue(inputDef.id, effectiveType, comp)}
										oninput={(
											e: Event & { currentTarget: HTMLInputElement },
										) => {
											const val = parseFloat(e.currentTarget.value) || 0;
											setComponentValue(
												inputDef.id,
												effectiveType,
												comp,
												val,
											);
										}}
									/>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}

			{#if nodeType === "group-output" && !isLocked}
				{@render addHandleButton()}
			{/if}
		</div>
	</div>
{:else}
	<div class="node-shell node-shell--unknown">
		Unknown node type: {nodeType}
	</div>
{/if}
