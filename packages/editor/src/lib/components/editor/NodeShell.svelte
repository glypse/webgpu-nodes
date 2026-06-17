<script lang="ts">
	import { Handle, Position, useSvelteFlow, useNodeConnections } from "@xyflow/svelte";
	import { nodeRegistry } from "./registry";
	import type { NodeDescriptor } from "./types";

	let {
		id,
		data: rawData,
		type: nodeType
	}: {
		id: string;
		data: Record<string, unknown>;
		type: string;
	} = $props();

	// Shallow-clone the prop so changes to data trigger fine-grained reactivity
	let data = $derived({ ...rawData });

	const { updateNodeData } = useSvelteFlow();

	const descriptor = $derived(nodeRegistry[nodeType]) as NodeDescriptor | undefined;
	const inputs = $derived(descriptor?.inputs ?? []);
	const outputs = $derived(descriptor?.outputs ?? []);
	const label = $derived(descriptor?.label ?? nodeType);

	// Track which target handles are connected (hook must be called at top level)
	const connections = useNodeConnections({ handleType: "target" });
	const connectedHandles = $derived(new Set(connections.current.map((c) => c.targetHandle)));

	// Compute handle positions: spread them evenly within [20%, 80%]
	function handleTop(index: number, count: number): string {
		if (count <= 1) return "50%";
		return String(20 + (index / (count - 1)) * 60) + "%";
	}
</script>

{#if descriptor}
	<div class="node-shell">
		<div class="node-shell__label">{label}</div>

		<div class="node-shell__body">
			<div class="node-shell__inputs">
				{#each inputs as inputDef, i (inputDef.name)}
					<div class="node-shell__row">
						<Handle
							type="target"
							position={Position.Left}
							id={inputDef.name}
							style={`top: ${handleTop(i, inputs.length)}`}
						/>
						<span class="node-shell__handle-label">{inputDef.name}: {inputDef.type}</span>

						{#if inputDef.type === "f32" && !inputDef.variadic && data[inputDef.name] !== undefined && !connectedHandles.has(inputDef.name)}
							<input
								type="number"
								class="nodrag node-shell__input"
								step="0.01"
								value={data[inputDef.name]}
								oninput={(e) => {
									const val = parseFloat(e.currentTarget.value) || 0;
									updateNodeData(id, {
										...data,
										[inputDef.name]: val
									});
								}}
							/>
						{/if}
					</div>
				{/each}
			</div>

			<div class="node-shell__outputs">
				{#each outputs as outputDef, i (outputDef.name)}
					<div class="node-shell__row node-shell__row--right">
						<span class="node-shell__handle-label">{outputDef.name}: {outputDef.type}</span>
						<Handle
							type="source"
							position={Position.Right}
							id={outputDef.name}
							style={`top: ${handleTop(i, outputs.length)}`}
						/>
					</div>
				{/each}
			</div>
		</div>
	</div>
{:else}
	<div class="node-shell node-shell--unknown">
		Unknown node type: {nodeType}
	</div>
{/if}

<style>
	.node-shell--unknown {
		color: #f38ba8;
		border-color: #f38ba8;
	}

	.node-shell__label {
		font-weight: 600;
		font-size: 12px;
		text-align: center;
		padding-bottom: 6px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		margin-bottom: 6px;
		letter-spacing: 0.5px;
	}

	.node-shell__body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.node-shell__inputs,
	.node-shell__outputs {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.node-shell__row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
	}

	.node-shell__row--right {
		justify-content: flex-end;
	}

	.node-shell__handle-label {
		font-size: 10px;
		opacity: 0.7;
		white-space: nowrap;
	}

	.node-shell__input {
		width: 60px;
		padding: 2px 4px;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.3);
		color: inherit;
		font-size: 10px;
		font-family: inherit;
		text-align: right;
	}

	.node-shell__input:focus {
		outline: none;
		border-color: var(--xy-theme-color-focus, #89b4fa);
	}
</style>
