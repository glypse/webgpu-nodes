<script lang="ts">
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import type { Edge, Node } from "@xyflow/svelte";
	import GraphContent from "./GraphContent.svelte";
	import { defaultDataForType } from "./registry";

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
</script>

<SvelteFlowProvider>
	<GraphContent bind:nodes bind:edges bind:frag class={className} />
</SvelteFlowProvider>
