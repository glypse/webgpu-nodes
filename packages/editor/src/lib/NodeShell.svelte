<script lang="ts">
	import { Button, Popover, Scrubbable } from "$theme";
	import { Handle, Position, useNodeConnections, useSvelteFlow } from "@xyflow/svelte";
	import FadersIcon from "phosphor-svelte/lib/FadersIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import TreeViewIcon from "phosphor-svelte/lib/TreeViewIcon";

	import { getGraphManager } from "./graph-state.svelte";
	import { type HandleDef, type WgslType, WGSL_TYPES } from "./types";

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

	// Whether *this* group node is locked (e.g. a standard-library instance),
	// distinct from the document-level lock derived above.
	const nodeLocked = $derived(fullNode?.group?.locked ?? false);

	const inputs = $derived(descriptor?.inputs);
	const outputs = $derived(descriptor?.outputs);
	const label = $derived(descriptor?.label);

	// The group node instance whose configuration sheet this node's faders
	// button should open. For a group node it's itself; for the group-input /
	// group-output boundary nodes it's the containing group (current path head).
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
		{#if nodeType === "node-group"}
			<div class="float-right flex flex-row items-center gap-1 ms-2">
				<TreeViewIcon class="size-4" />
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
		<span>{label}</span>
	</div>

	<div class="node-shell__body">
		<div class="node-shell__outputs">
			{#each outputs as outputDef (outputDef.id)}
				<div class="node-shell__row node-shell__row--right">
					<span class="node-shell__handle-label">{outputDef.label}: {outputDef.type}</span
					>
					<Handle
						type="source"
						position={Position.Right}
						id={outputDef.id}
						class="node-shell__handle node-shell__handle--right"
					/>
				</div>
			{/each}

			{#if nodeType === "group-input" && !isLocked}
				{@render addHandleButton()}
			{/if}
		</div>

		<div class="node-shell__inputs">
			{#each inputs as inputDef (inputDef.id)}
				<div class="node-shell__row">
					<Handle
						type="target"
						position={Position.Left}
						id={inputDef.id}
						class="node-shell__handle node-shell__handle--left"
					/>
					{#if inputDef.type !== "f32"}
						<span class="node-shell__handle-label"
							>{inputDef.label}: {inputDef.type}</span
						>
					{/if}

					{#if inputDef.type === "f32" && !inputDef.variadic}
						{#if connectedHandles.has(inputDef.id)}
							<span
								class="text-muted-foreground pointer-events-none shrink-0 pr-1 text-xs"
							>
								{inputDef.label}
							</span>
						{:else}
							<Scrubbable
								class="node-shell__input"
								label={inputDef.label}
								readonly={isLocked}
								value={(data[inputDef.id] as number | undefined) ?? 0}
								oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
									const val = parseFloat(e.currentTarget.value) || 0;
									updateNodeData(id, {
										...data,
										[inputDef.id]: val,
									});
								}}
							/>
						{/if}
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
