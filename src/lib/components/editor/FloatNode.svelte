<script module lang="ts">
	import type { Node } from "@xyflow/svelte";
	export type FloatNodeType = Node<{ value: number }, "float">;
</script>

<script lang="ts">
	import { Handle, Position, useSvelteFlow } from "@xyflow/svelte";

	let { id, data }: { id: string; data: { value: number } } = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<div class="custom">
	<div>f32 ({id})</div>
	<div>
		<input
			type="number"
			class="nodrag"
			step="0.1"
			value={data.value}
			oninput={(evt) => {
				updateNodeData(id, { value: parseFloat(evt.currentTarget.value) || 0 });
			}}
		/>
	</div>
	<Handle type="source" position={Position.Right} />
</div>
