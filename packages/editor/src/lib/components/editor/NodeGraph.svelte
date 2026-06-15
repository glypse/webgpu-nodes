<script lang="ts">
	import { SvelteFlow, Controls, Background, type Edge, type Node } from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import "./xy-theme.css";
	import { cn } from "$editor/utils";

	import NodeShell from "./NodeShell.svelte";
	import { generateShader, debugSort } from "./codegen";
	import { nodeRegistry, defaultDataForType } from "./registry";

	/**
	 * nodeTypes for SvelteFlow:
	 * Nodes that need custom UI (interactive controls) get their own .svelte component.
	 * All other nodes use the generic NodeShell.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow nodeTypes accepts any Svelte component
	const nodeTypes: Record<string, any> = {};

	// Auto-register all other nodes from the registry with the generic shell
	for (const type of Object.keys(nodeRegistry)) {
		if (!(type in nodeTypes)) {
			nodeTypes[type] = NodeShell;
		}
	}

	let debug = $state(true);

	let { class: className, frag = $bindable() }: { class?: string; frag?: string } = $props();

	let nodes = $state.raw<Node[]>([
		{
			id: "uvNode",
			type: "uv",
			data: defaultDataForType("uv"),
			position: { x: -300, y: -200 }
		},
		{
			id: "separateUvs",
			type: "separateVec2f",
			data: defaultDataForType("separateVec2f"),
			position: { x: -100, y: -200 }
		},
		{
			id: "a",
			type: "float",
			data: { value: 0.3 },
			position: { x: -300, y: -100 }
		},
		{
			id: "b",
			type: "float",
			data: { value: 0.6 },
			position: { x: -300, y: 50 }
		},
		{
			id: "c",
			type: "float",
			data: { value: 1.0 },
			position: { x: -300, y: 200 }
		},
		{
			id: "b2",
			type: "float",
			data: { value: 0.4 },
			position: { x: -300, y: 125 }
		},
		{
			id: "d",
			type: "float",
			data: { value: 0.0 },
			position: { x: -300, y: 350 }
		},
		{
			id: "opacity",
			type: "float",
			data: { value: 1.0 },
			position: { x: -300, y: 500 }
		},
		{
			id: "add1",
			type: "add",
			data: defaultDataForType("add"),
			position: { x: -50, y: 0 }
		},
		{
			id: "vec4f1",
			type: "vec4f",
			data: defaultDataForType("vec4f"),
			position: { x: 200, y: 50 }
		},
		{
			id: "out1",
			type: "output",
			data: defaultDataForType("output"),
			position: { x: 450, y: 150 }
		}
	]);

	let edges = $state.raw<Edge[]>([
		{ id: "e-a-add1", source: "a", target: "add1" },
		{ id: "e-b-add1", source: "b", target: "add1" },
		{ id: "e-add1-vec4f1", source: "add1", target: "vec4f1", targetHandle: "x" },
		{ id: "e-c-vec4f1", source: "c", target: "vec4f1", targetHandle: "y" },
		{ id: "e-d-vec4f1", source: "d", target: "vec4f1", targetHandle: "z" },
		{ id: "e-opacity-vec4f1", source: "opacity", target: "vec4f1", targetHandle: "w" },
		{ id: "e-vec4f1-out1", source: "vec4f1", target: "out1" }
	]);

	function track(): void {
		void nodes.length;
		void edges.length;
	}

	$effect(() => {
		track();
		frag = generateShader(nodes, edges);

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (debug) {
			const sortedIds = debugSort(nodes, edges);
			console.group("[shader debug]");
			console.log("Compiled fragment shader: ", frag);
			console.log("Sorted order:", sortedIds.toString());
			console.log("Nodes:", JSON.stringify(nodes));
			console.log("Edges:", JSON.stringify(edges));
			console.groupEnd();
		}
	});

	// eslint-disable-next-line svelte/no-inspect
	$inspect(frag).with(console.log);
</script>

<SvelteFlow
	bind:nodes
	bind:edges
	{nodeTypes}
	colorMode="system"
	fitView
	class={cn("h-full", className)}
	proOptions={{ hideAttribution: true }}
>
	<Controls showLock={false} showZoom={false} />
	<Background />
</SvelteFlow>
