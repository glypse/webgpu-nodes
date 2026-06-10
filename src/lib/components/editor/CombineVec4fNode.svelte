<script module lang="ts">
	import type { Node } from "@xyflow/svelte";
	export type CombineVec4fNodeType = Node<Record<string, never>, "combineVec4f">;
</script>

<script lang="ts">
	import { Handle, Position } from "@xyflow/svelte";

	// eslint-disable-next-line no-empty-pattern -- needed to make component accept props
	let {} = $props();
</script>

<div class="custom">
	<Handle type="target" position={Position.Left} id="x" style="top: 20%" />
	<Handle type="target" position={Position.Left} id="y" style="top: 40%" />
	<Handle type="target" position={Position.Left} id="z" style="top: 60%" />
	<Handle type="target" position={Position.Left} id="w" style="top: 80%" />
	<div>Combine vec4f</div>
	<Handle type="source" position={Position.Right} />
</div>
