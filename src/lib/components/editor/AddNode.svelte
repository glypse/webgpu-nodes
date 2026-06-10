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
	<Handle type="target" position={Position.Left} id="a" style="top: 33.3333%" />
	<Handle type="target" position={Position.Left} id="b" style="top: 66.6666%" />
	<Handle type="source" position={Position.Right} />
</div>
