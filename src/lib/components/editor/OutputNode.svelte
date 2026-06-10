<script module lang="ts">
	import type { Node } from "@xyflow/svelte";
	export type OutputNodeType = Node<Record<string, never>, "output">;
</script>

<script lang="ts">
	import { Handle, Position } from "@xyflow/svelte";

	// eslint-disable-next-line no-empty-pattern -- needed to make component accept props
	let {} = $props();
</script>

<div class="custom">
	<Handle type="target" position={Position.Left} />
	<div>Output (frag)</div>
</div>
