<script lang="ts">
	import { SvelteFlow, Controls, Background, type Edge } from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import "./xy-theme.css";
	import { cn } from "$lib/utils";
	import { dev } from "$app/environment";

	import FloatNode, { type FloatNodeType } from "./FloatNode.svelte";
	import AddNode, { type AddNodeType } from "./AddNode.svelte";
	import CombineVec4fNode, { type CombineVec4fNodeType } from "./CombineVec4fNode.svelte";
	import OutputNode, { type OutputNodeType } from "./OutputNode.svelte";
	import { generateShader } from "./codegen.js";
	import type { ShaderNode } from "./types.js";

	const nodeTypes = {
		float: FloatNode,
		add: AddNode,
		combineVec4f: CombineVec4fNode,
		output: OutputNode
	};

	// eslint-disable-next-line no-useless-assignment -- frag is used in the parent
	let { class: className, frag = $bindable() }: { class?: string; frag?: string } = $props();

	// Used inside $effect to track reactive node/edge changes
	function track(): void {
		void nodes.length;
		void edges.length;
	}

	type MyNode = FloatNodeType | AddNodeType | CombineVec4fNodeType | OutputNodeType;

	let nodes = $state.raw<MyNode[]>([
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
			data: {},
			position: { x: -50, y: 0 }
		},
		{
			id: "combine1",
			type: "combineVec4f",
			data: {},
			position: { x: 200, y: 50 }
		},
		{
			id: "out1",
			type: "output",
			data: {},
			position: { x: 450, y: 150 }
		}
	]);

	let edges = $state.raw<Edge[]>([
		{ id: "e-a-add1", source: "a", target: "add1", targetHandle: "a" },
		{ id: "e-b-add1", source: "b", target: "add1", targetHandle: "b" },
		{ id: "e-add1-combine1", source: "add1", target: "combine1", targetHandle: "x" },
		{ id: "e-c-combine1", source: "c", target: "combine1", targetHandle: "y" },
		{ id: "e-d-combine1", source: "d", target: "combine1", targetHandle: "z" },
		{ id: "e-opacity-combine1", source: "opacity", target: "combine1", targetHandle: "w" },
		{ id: "e-combine1-out1", source: "combine1", target: "out1" }
	]);

	// Re-generate the shader whenever nodes or edges change
	$effect(() => {
		track();
		frag = generateShader(nodes as ShaderNode[], edges);
	});
</script>

<SvelteFlow
	bind:nodes
	bind:edges
	{nodeTypes}
	colorMode="system"
	fitView
	class={cn("h-full", className)}
	proOptions={{ hideAttribution: !dev }}
>
	<Controls showLock={false} showZoom={false} />
	<Background />
</SvelteFlow>
