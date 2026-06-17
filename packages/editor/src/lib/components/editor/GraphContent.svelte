<script lang="ts">
	import {
		SvelteFlow,
		useSvelteFlow,
		Controls,
		Background,
		type Edge,
		type Node
	} from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import "./xy-theme.css";
	import { cn } from "$editor/utils";
	import * as ContextMenu from "$editor/components/ui/context-menu/index.js";

	import NodeShell from "./NodeShell.svelte";
	import { generateShader, debugSort, shaderHash } from "./codegen";
	import { nodeRegistry, defaultDataForType, nodesByCategory } from "./registry";
	import type { NodeCategory } from "./types";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow node types accept any component
	const nodeTypes: Record<string, any> = {};
	for (const type of Object.keys(nodeRegistry)) {
		nodeTypes[type] = NodeShell;
	}

	let debug = $state(true);

	let {
		class: className,
		nodes = $bindable([]),
		edges = $bindable([]),
		frag = $bindable(""),
		nodeIdCounter = $bindable(nodes.length + 1)
	}: {
		class?: string;
		nodes?: Node[];
		edges?: Edge[];
		frag?: string;
		nodeIdCounter?: number;
	} = $props();

	const categoryMap = $derived(nodesByCategory());

	const { screenToFlowPosition } = useSvelteFlow();

	let contextMenuPosition = $state({ x: 0, y: 0 });

	function addNode(type: string) {
		const id = `node-${String(nodeIdCounter++)}`;
		const position = screenToFlowPosition({
			x: contextMenuPosition.x,
			y: contextMenuPosition.y
		});
		nodes = [
			...nodes,
			{
				id,
				type,
				data: defaultDataForType(type),
				position
			}
		];
	}

	// Track the shader-relevant hash to avoid rebuilding on position changes
	let prevHash = $state("");

	$effect(() => {
		const hash = shaderHash(nodes, edges);
		if (hash === prevHash) return;
		prevHash = hash;
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

	function categoryLabel(category: NodeCategory): string {
		const labels: Record<NodeCategory, string> = {
			math: "Math",
			input: "Input",
			output: "Output",
			color: "Color",
			vector: "Vector"
		};
		return labels[category];
	}

	function handleContextMenu(e: MouseEvent) {
		contextMenuPosition = { x: e.clientX, y: e.clientY };
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div oncontextmenu={handleContextMenu} class="size-full">
	<ContextMenu.Root>
		<ContextMenu.Trigger class="block size-full">
			<SvelteFlow
				bind:nodes
				bind:edges
				{nodeTypes}
				colorMode="system"
				fitView
				minZoom={0.1}
				maxZoom={3}
				class={cn("h-full", className)}
				proOptions={{ hideAttribution: false }}
			>
				<Controls showLock={false} showZoom={false} />
				<Background />
			</SvelteFlow>
		</ContextMenu.Trigger>

		<ContextMenu.Content class="w-20">
			{#each [...categoryMap.entries()] as [category, items] (category)}
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>{categoryLabel(category)}</ContextMenu.SubTrigger>
					<ContextMenu.SubContent>
						{#each items as item (item.type)}
							<ContextMenu.Item
								onclick={() => {
									addNode(item.type);
								}}
							>
								{item.label}
							</ContextMenu.Item>
						{/each}
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
			{/each}
		</ContextMenu.Content>
	</ContextMenu.Root>
</div>
