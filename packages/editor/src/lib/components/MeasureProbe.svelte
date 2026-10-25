<script lang="ts">
	import type { NodeGeometry } from "$core";
	import { useNodesInitialized, useSvelteFlow } from "@xyflow/svelte";

	import { measureInternalNode } from "../geometry/measure";

	let {
		nodeIds,
		onmeasured,
	}: {
		nodeIds: readonly string[];
		onmeasured: (geometry: Map<string, NodeGeometry>) => void;
	} = $props();

	const { getInternalNode } = useSvelteFlow();
	const initialized = useNodesInitialized();

	let done = false;
	$effect(() => {
		if (done || (nodeIds.length > 0 && !initialized.current)) return;
		done = true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- handed over, not state
		const geometry = new Map<string, NodeGeometry>();
		for (const id of nodeIds) {
			const measured = measureInternalNode(getInternalNode(id));
			if (measured) geometry.set(id, measured);
		}
		onmeasured(geometry);
	});
</script>
