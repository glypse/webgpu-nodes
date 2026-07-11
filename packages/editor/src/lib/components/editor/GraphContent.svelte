<script lang="ts">
	import { ContextMenu } from "$theme/components/ui";

	import "./xy-theme.css";
	import { cn } from "$theme/utils";
	import {
		SvelteFlow,
		useSvelteFlow,
		Controls,
		Background,
		type Edge,
		type Node,
	} from "@xyflow/svelte";
	import { mode } from "mode-watcher";

	import { generateShader, debugSort, projectHash } from "./codegen";
	import { getGraphManager } from "./graph-state.svelte";
	import NodeShell from "./NodeShell.svelte";
	import {
		nodeRegistry,
		defaultDataForType,
		nodesByCategory,
		DYNAMIC_NODE_TYPES,
	} from "./registry";
	import { type NodeCategory } from "./types";
	import { getDevContext } from "./utils";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow node types accept any component
	const nodeTypes: Record<string, any> = {};
	for (const type of [...Object.keys(nodeRegistry), ...DYNAMIC_NODE_TYPES]) {
		nodeTypes[type] = NodeShell;
	}

	let debug = getDevContext();

	let {
		class: className,
		nodes = $bindable([]),
		edges = $bindable([]),
		frag = $bindable(""),
	}: {
		class?: string;
		nodes?: Node[];
		edges?: Edge[];
		frag?: string;
	} = $props();

	const categoryMap = $derived(nodesByCategory());

	const { screenToFlowPosition, getNodes } = useSvelteFlow();
	const graph = getGraphManager();

	let contextMenuPosition = $state({ x: 0, y: 0 });

	function addNode(type: string) {
		const id = crypto.randomUUID();
		const position = screenToFlowPosition({
			x: contextMenuPosition.x,
			y: contextMenuPosition.y,
		});
		nodes = [
			...nodes,
			{
				id,
				type,
				data: defaultDataForType(type),
				position,
			},
		];
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			const allNodes = getNodes();
			const selected = allNodes.find((n) => n.selected);
			if (!selected) return;

			if (selected.type === "node-group") {
				event.preventDefault();
				graph.enterGroup(selected.id);
			}
		} else if (event.key === "Escape" && graph.path.length > 0) {
			event.preventDefault();
			graph.exitGroup();
		} else if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			const selectedIds = new Set(
				getNodes()
					.filter((node) => node.selected)
					.map((node) => node.id),
			);
			if (selectedIds.size >= 1) {
				graph.groupSelection(selectedIds);
			}
		}
	}

	// Track the shader-relevant hash to avoid rebuilding on position changes.
	// Always hash & generate from the ROOT graph so the shader stays valid
	// even when the user is viewing a subgraph.
	// projectHash covers the full project so edits inside subgraphs trigger re-generation.
	let prevHash = $state("");

	$effect(() => {
		const rootNodes = graph.project.root.nodes;
		const rootEdges = graph.project.root.edges;
		const hash = projectHash(graph.project);
		if (hash === prevHash) return;
		prevHash = hash;
		frag = generateShader(rootNodes, rootEdges);

		if (debug) {
			const sortedIds = debugSort(rootNodes, rootEdges);
			console.group("[shader debug]");
			console.log("Compiled fragment shader:\n", frag);
			console.log("Sorted order:\n", sortedIds.join("\n"));
			/* console.log("Nodes:", JSON.stringify(nodes), null, "\t"));
			console.log("Edges:", JSON.stringify(edges, null, "\t")); */
			console.log(JSON.parse(graph.getProjectJson()));
			console.groupEnd();
		}
	});

	function categoryLabel(category: NodeCategory): string {
		const labels: Record<NodeCategory, string> = {
			math: "Math",
			input: "Input",
			output: "Output",
			color: "Color",
			vector: "Vector",
		};
		return labels[category];
	}

	function handleContextMenu(e: MouseEvent) {
		contextMenuPosition = { x: e.clientX, y: e.clientY };
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div oncontextmenu={handleContextMenu} onkeydown={handleKeydown} class="size-full">
	<ContextMenu.Root>
		<ContextMenu.Trigger class="block size-full">
			<SvelteFlow
				bind:nodes
				bind:edges
				{nodeTypes}
				colorMode={mode.current}
				fitView
				minZoom={0.1}
				maxZoom={3}
				class={cn("", className)}
				proOptions={{ hideAttribution: !debug }}
			>
				<Controls showLock={false} showZoom={false} />
				<Background class="bg-background" />
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
