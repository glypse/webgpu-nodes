<script module lang="ts">
	import type { Node } from "@xyflow/svelte";
	export type AddNodeType = Node<Record<string, never>, "add">;
</script>

<script lang="ts">
	import { Handle, Position } from "@xyflow/svelte";

	// eslint-disable-next-line no-empty-pattern -- needed to make component accept props
	let {} = $props();
</script>

<div class="custom">
	<div class="node-label">Add</div>
	<Handle type="target" position={Position.Left} />
	<Handle type="source" position={Position.Right} />
</div>
