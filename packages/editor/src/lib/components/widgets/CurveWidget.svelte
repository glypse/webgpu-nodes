<script lang="ts">
	import { type CurvePoint, LINEAR_CURVE } from "$core";
	import { CurveEditor } from "$theme";

	import { getGraphManager } from "../../graph-manager.svelte";

	let {
		id,
		curve,
		disabled,
	}: {
		id: string;
		curve: readonly CurvePoint[] | undefined;
		disabled: boolean;
	} = $props();

	const graph = getGraphManager();
</script>

<CurveEditor
	class="py-1"
	points={curve ?? LINEAR_CURVE}
	{disabled}
	onchange={(points: CurvePoint[]) => {
		graph.setCurve(id, points);
	}}
/>
