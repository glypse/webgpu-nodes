<script lang="ts">
	import { Button } from "$theme/components/ui/button";
	import { Scrubbable } from "$theme/components/ui/scrubbable";
	import { Handle, Position, useNodeConnections, useSvelteFlow } from "@xyflow/svelte";

	import { getGraphManager } from "./graph-state.svelte";
	import type { HandleDef } from "./types";

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

	const fullNode = $derived(graph.activeDocument.nodes.find((n) => n.id === id));
	const descriptor = $derived(fullNode ? graph.resolveDescriptor(fullNode) : undefined);

	const inputs = $derived(descriptor?.inputs);
	const outputs = $derived(descriptor?.outputs);
	const label = $derived(descriptor?.label);

	const connections = useNodeConnections({ handleType: "target" });
	const connectedHandles = $derived(new Set(connections.current.map((c) => c.targetHandle)));

	function addHandle() {
		const handles = (data.handles ?? []) as HandleDef[];
		const newHandle: HandleDef = {
			id: crypto.randomUUID(),
			label: `Handle ${String(handles.length + 1)}`,
			type: "f32",
		};
		updateNodeData(id, {
			...data,
			handles: [...handles, newHandle],
			[newHandle.id]: 0,
		});
	}
</script>

{#snippet addHandleButton()}
	<Button onclick={addHandle}>+</Button>
{/snippet}

{#if descriptor}
	<div class="node-shell__label">
		<span>
			{label}
		</span>
	</div>

	<div class="node-shell__body">
		<div class="node-shell__outputs">
			{#each outputs as outputDef (outputDef.name)}
				<div class="node-shell__row node-shell__row--right">
					<span class="node-shell__handle-label">{outputDef.name}: {outputDef.type}</span>
					<Handle
						type="source"
						position={Position.Right}
						id={outputDef.name}
						class="node-shell__handle node-shell__handle--right"
					/>
				</div>
			{/each}

			{#if nodeType === "group-input"}
				{@render addHandleButton()}
			{/if}
		</div>

		<div class="node-shell__inputs">
			{#each inputs as inputDef (inputDef.name)}
				<div class="node-shell__row">
					<Handle
						type="target"
						position={Position.Left}
						id={inputDef.name}
						class="node-shell__handle node-shell__handle--left"
					/>
					{#if inputDef.type !== "f32"}
						<span class="node-shell__handle-label"
							>{inputDef.name}: {inputDef.type}</span
						>
					{/if}

					{#if inputDef.type === "f32" && !inputDef.variadic && data[inputDef.name] !== undefined}
						<Scrubbable
							class="node-shell__input"
							label={inputDef.name}
							readonly={connectedHandles.has(inputDef.name)}
							value={data[inputDef.name] as number}
							oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
								const val = parseFloat(e.currentTarget.value) || 0;
								updateNodeData(id, {
									...data,
									[inputDef.name]: val,
								});
							}}
						/>
					{/if}
				</div>
			{/each}

			{#if nodeType === "group-output"}
				{@render addHandleButton()}
			{/if}
		</div>
	</div>
{:else}
	<div class="node-shell node-shell--unknown">
		Unknown node type: {nodeType}
	</div>
{/if}
