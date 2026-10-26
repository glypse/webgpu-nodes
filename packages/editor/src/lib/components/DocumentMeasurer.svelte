<script lang="ts">
	import type { HydratedGraphDocument, NodeGeometry } from "$core";
	import { SvelteFlow, SvelteFlowProvider } from "@xyflow/svelte";

	import { setDocumentView } from "../document-view";
	import MeasureProbe from "./MeasureProbe.svelte";
	import { nodeTypes } from "./node-types";

	/**
	 * Draws a document out of sight, with the same components and styles as
	 * the canvas, to measure its nodes as they'd be drawn there.
	 */
	let {
		document,
		onmeasured,
	}: {
		document: HydratedGraphDocument;
		onmeasured: (geometry: Map<string, NodeGeometry>) => void;
	} = $props();

	// Measured as editable: a read-only view hides controls, so it's never
	// taller than this.
	setDocumentView({
		get document() {
			return document;
		},
		locked: false,
		path: [],
		activate: () => undefined,
	});

	// Copies: SvelteFlow's bookkeeping stays out of the model's nodes.
	const nodes = $derived(document.nodes.map((n) => ({ ...n, selected: false })));
	const edges = $derived(document.edges.map((e) => ({ ...e })));
	const nodeIds = $derived(document.nodes.map((n) => n.id));
</script>

<div class="invisible fixed top-0 -left-[200vw] h-screen w-screen" aria-hidden="true" inert>
	<SvelteFlowProvider>
		<SvelteFlow {nodes} {edges} {nodeTypes} proOptions={{ hideAttribution: true }}>
			<MeasureProbe {nodeIds} {onmeasured} />
		</SvelteFlow>
	</SvelteFlowProvider>
</div>
