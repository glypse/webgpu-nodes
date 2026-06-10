<script module lang="ts">
	import type { Node } from "@xyflow/svelte";
	export type TextNodeType = Node<{ text: string }, "text">;
</script>

<script lang="ts">
	import { Handle, Position, useSvelteFlow } from "@xyflow/svelte";

	let { id, data }: { id: string; data: { text: string } } = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<div class="custom">
	<div>text</div>
	<div>
		<input
			value={data.text}
			oninput={(evt) => {
				updateNodeData(id, { text: evt.currentTarget.value });
			}}
		/>
	</div>
	<Handle type="source" position={Position.Right} />
</div>
