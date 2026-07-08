<script lang="ts">
	import { Scrubbable } from "$theme/components/ui/scrubbable";
	import { Handle, Position, useNodeConnections, useSvelteFlow } from "@xyflow/svelte";

	import { nodeRegistry } from "./registry";
	import type { NodeDescriptor } from "./types";

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

	const descriptor = $derived(nodeRegistry[nodeType]) as NodeDescriptor | undefined;
	const inputs = $derived(descriptor?.inputs ?? []);
	const outputs = $derived(descriptor?.outputs ?? []);
	const label = $derived(descriptor?.label ?? nodeType);

	const connections = useNodeConnections({ handleType: "target" });
	const connectedHandles = $derived(new Set(connections.current.map((c) => c.targetHandle)));
</script>

{#if descriptor}
	<div class="w-45">
		<div class="node-shell__label">
			<span>
				{label}
			</span>
		</div>

		<div class="node-shell__body">
			<div class="node-shell__outputs">
				{#each outputs as outputDef (outputDef.name)}
					<div class="node-shell__row node-shell__row--right">
						<span class="node-shell__handle-label"
							>{outputDef.name}: {outputDef.type}</span
						>
						<Handle
							type="source"
							position={Position.Right}
							id={outputDef.name}
							class="node-shell__handle node-shell__handle--right"
						/>
					</div>
				{/each}
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
			</div>
		</div>
	</div>
{:else}
	<div class="node-shell node-shell--unknown">
		Unknown node type: {nodeType}
	</div>
{/if}
