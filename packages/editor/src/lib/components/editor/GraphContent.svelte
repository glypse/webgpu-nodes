<script lang="ts">
	import { ContextMenu, Input, Sheet } from "$theme/components/ui";
	import { Button } from "$theme/components/ui/button";

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
	import { nodeRegistry, defaultDataForType, DYNAMIC_NODE_TYPES } from "./registry";
	import { type HandleDef, type NodeCategory } from "./types";
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

	const categoryMap = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- static data, never mutated after creation
		const map = new Map<NodeCategory, { id: string; label: string; fromLibrary: boolean }[]>();
		const CONTEXT_MENU_EXCLUDED = new Set(["frag-output"]);
		for (const [type, desc] of Object.entries(nodeRegistry)) {
			if (CONTEXT_MENU_EXCLUDED.has(type)) continue;
			const list = map.get(desc.category) ?? [];
			list.push({ id: type, label: desc.label, fromLibrary: false });
			map.set(desc.category, list);
		}
		for (const entry of graph.library) {
			const list = map.get(entry.category as NodeCategory) ?? [];
			list.push({ id: entry.id, label: entry.label, fromLibrary: true });
			map.set(entry.category as NodeCategory, list);
		}
		return map;
	});

	const { screenToFlowPosition, getNodes } = useSvelteFlow();
	const graph = getGraphManager();

	const userGroups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- static data, never mutated after creation
		const seen = new Set<string>();
		const stdIds = new Set(graph.library.map((e) => e.id));
		const groups: { definitionRef: string; label: string }[] = [];

		function collectFromDoc(doc: {
			nodes: {
				type?: string;
				group?: { definitionRef: string };
			}[];
		}) {
			for (const node of doc.nodes) {
				if (
					node.type === "node-group" &&
					node.group &&
					!seen.has(node.group.definitionRef)
				) {
					seen.add(node.group.definitionRef);
					if (stdIds.has(node.group.definitionRef)) continue;
					const def = graph.project.definitions[node.group.definitionRef];
					groups.push({
						definitionRef: node.group.definitionRef,
						label: def?.label ?? "Group",
					});
				}
			}
		}

		collectFromDoc(graph.project.root);
		for (const def of Object.values(graph.project.definitions)) {
			collectFromDoc(def);
		}

		// Also include definitions that exist in the project but aren't referenced
		// by any node-group in the graph (e.g. imported from JSON but not yet placed).
		for (const defRef of Object.keys(graph.project.definitions)) {
			if (seen.has(defRef) || stdIds.has(defRef)) continue;
			seen.add(defRef);
			const def = graph.project.definitions[defRef];
			groups.push({ definitionRef: defRef, label: def?.label ?? "Group" });
		}

		return groups;
	});

	const isLocked = $derived(graph.isLocked);

	let contextMenuPosition = $state({ x: 0, y: 0 });

	let sheetOpen = $state(false);
	let sheetGroupId = $state<string | null>(null);

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

	function addFromLibrary(definitionRef: string) {
		const position = screenToFlowPosition({
			x: contextMenuPosition.x,
			y: contextMenuPosition.y,
		});
		graph.addFromLibrary(definitionRef, position);
	}

	function handleKeydown(event: KeyboardEvent) {
		const tag = (event.target as HTMLElement | null)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA") return;

		if (event.key === "Enter") {
			const allNodes = getNodes();
			const selected = allNodes.find((n) => n.selected);
			if (!selected) return;

			if (selected.type === "node-group") {
				event.preventDefault();
				graph.enterGroup(selected.id);
			}
		} else if (event.key === "Escape") {
			if (sheetOpen) {
				event.preventDefault();
				sheetOpen = false;
			} else if (graph.path.length > 0) {
				event.preventDefault();
				graph.exitGroup();
			}
		} else if (event.key === "n" && !event.metaKey && !event.ctrlKey) {
			const selectedGroupRef = graph.selectedGroupRef;
			let targetNodeId: string | undefined;

			if (selectedGroupRef) {
				// A group node is selected - use it
				const groupNode = graph.activeDocument.nodes.find(
					(n) => n.type === "node-group" && n.group?.definitionRef === selectedGroupRef,
				);
				targetNodeId = groupNode?.id;
			} else if (graph.path.length > 0) {
				// Inside a subgraph - use the group we're currently viewing
				let current = graph.project.root;
				for (const nodeId of graph.path) {
					const node = current.nodes.find((n) => n.id === nodeId);
					if (!node?.group) break;
					targetNodeId = nodeId;
					const def = graph.project.definitions[node.group.definitionRef];
					if (!def) break;
					current = def;
				}
			}

			if (targetNodeId) {
				event.preventDefault();
				if (sheetOpen && sheetGroupId === targetNodeId) {
					sheetOpen = false;
				} else {
					sheetGroupId = targetNodeId;
					sheetOpen = true;
				}
			} else if (sheetOpen) {
				sheetOpen = false;
			}
		} else if (event.key === "g") {
			if (isLocked) return;
			event.preventDefault();
			const selectedIds = new Set(
				getNodes()
					.filter((node) => node.selected)
					.map((node) => node.id),
			);
			if (selectedIds.size >= 1) {
				graph.groupSelection(selectedIds);
			}
		} else if (event.key === "Delete" || event.key === "Backspace") {
			if (isLocked) {
				event.preventDefault();
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

	// Close the group config sheet when selection no longer contains a group node.
	$effect(() => {
		const _ids = graph.selectedNodeIds;
		if (!sheetOpen) return;
		// Keep the sheet open when we're inside a group (viewing its contents).
		if (graph.path.length > 0) return;
		const hasGroup = _ids.some((id) => {
			const node = graph.activeDocument.nodes.find((n) => n.id === id);
			return node?.type === "node-group" && node.group;
		});
		if (!hasGroup) {
			sheetOpen = false;
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

	const sheetGroupNode = $derived.by(() => {
		if (!sheetGroupId) return undefined;
		// When inside a group, the node-group node lives in the parent document,
		// not the active (subgraph) document.
		const doc = graph.path.length > 0 ? graph.parentDocument : graph.activeDocument;
		return doc.nodes.find((n) => n.id === sheetGroupId);
	});
	const sheetDefinition = $derived(
		sheetGroupNode?.group
			? graph.project.definitions[sheetGroupNode.group.definitionRef]
			: undefined,
	);
	const sheetLocked = $derived(sheetGroupNode?.group?.locked ?? true);
	const sheetInputHandles = $derived.by(() => {
		if (!sheetDefinition) return [];
		const inputNode = sheetDefinition.nodes.find((n) => n.type === "group-input");
		return (inputNode?.data.handles ?? []) as HandleDef[];
	});
	const sheetOutputHandles = $derived.by(() => {
		if (!sheetDefinition) return [];
		const outputNode = sheetDefinition.nodes.find((n) => n.type === "group-output");
		return (outputNode?.data.handles ?? []) as HandleDef[];
	});
	const sheetInputNodeId = $derived(
		sheetDefinition?.nodes.find((n) => n.type === "group-input")?.id,
	);
	const sheetOutputNodeId = $derived(
		sheetDefinition?.nodes.find((n) => n.type === "group-output")?.id,
	);

	// Local buffer for handle label inputs - keeps the input responsive while
	// the actual graph mutation is committed on blur to avoid triggering shader re-gen.
	const handleLabelBuffer = $state<Record<string, string>>({});

	// Initialise the buffer when the sheet opens or handles change,
	// so the template never mutates $state during evaluation.
	$effect(() => {
		const _inputs = sheetInputHandles;
		const _outputs = sheetOutputHandles;
		for (const h of _inputs) {
			if (!(h.id in handleLabelBuffer)) handleLabelBuffer[h.id] = h.label;
		}
		for (const h of _outputs) {
			if (!(h.id in handleLabelBuffer)) handleLabelBuffer[h.id] = h.label;
		}
	});

	function handleLabelValue(handleId: string): string {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- initialised in $effect above
		return handleLabelBuffer[handleId]!;
	}

	// Local buffer for the group label input - keeps the input responsive while
	// the actual graph mutation is debounced to avoid triggering shader re-gen.
	let groupLabelBuffer = $state("");
	const groupLabelInvalid = $derived(
		!sheetLocked &&
			groupLabelBuffer.trim() !== "" &&
			!graph.isLabelAvailable(groupLabelBuffer, sheetGroupNode?.group?.definitionRef),
	);

	$effect(() => {
		const _def = sheetDefinition;
		groupLabelBuffer = _def?.label ?? "";
	});

	function commitGroupLabel() {
		if (sheetGroupId && groupLabelBuffer.trim()) {
			graph.setGroupLabel(sheetGroupId, groupLabelBuffer);
		}
	}

	function commitHandleLabel(defRef: string, nodeId: string, handleId: string, value: string) {
		if (value.trim()) {
			graph.setHandleLabel(defRef, nodeId, handleId, value);
		}
	}

	function handleEnterBlur(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			(e.target as HTMLInputElement).blur();
		}
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
				colorMode={mode.current}
				fitView
				minZoom={0.1}
				maxZoom={3}
				class={cn("", className)}
				proOptions={{ hideAttribution: !debug }}
				nodesDraggable={!isLocked}
				nodesConnectable={!isLocked}
				elementsSelectable={!isLocked}
				deleteKey={isLocked ? null : undefined}
				onbeforedelete={isLocked ? () => Promise.resolve(false) : undefined}
				onselectionchange={({ nodes: selectedNodes }) => {
					graph.selectedNodeIds = selectedNodes.map((n) => n.id);
				}}
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
						{#each items as item (item.id)}
							<ContextMenu.Item
								disabled={graph.wouldCreateCycle(item.id)}
								onclick={() => {
									if (item.fromLibrary) {
										addFromLibrary(item.id);
									} else {
										addNode(item.id);
									}
								}}
							>
								{item.label}
							</ContextMenu.Item>
						{/each}
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
			{/each}
			{#if userGroups.length > 0}
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>Groups</ContextMenu.SubTrigger>
					<ContextMenu.SubContent>
						{#each userGroups as group (group.definitionRef)}
							<ContextMenu.Item
								disabled={graph.wouldCreateCycle(group.definitionRef)}
								onclick={() => addFromLibrary(group.definitionRef)}
							>
								{group.label}
							</ContextMenu.Item>
						{/each}
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
</div>

<svelte:window onkeydown={handleKeydown} />

<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content
		class="w-[350px] sm:w-[400px]"
		onOpenAutoFocus={(e: Event) => e.preventDefault()}
		escapeKeydownBehavior="ignore"
	>
		<Sheet.Header>
			<Sheet.Title>Group Settings</Sheet.Title>
		</Sheet.Header>
		{#if sheetGroupNode && sheetDefinition}
			<div class="flex flex-col gap-4 p-4">
				<Button
					variant="outline"
					onclick={() => {
						if (sheetGroupId) {
							graph.deepClone(sheetGroupId);
						}
					}}
				>
					Clone & Edit
				</Button>

				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">Group Label</span>
					<Input.Root
						value={groupLabelBuffer}
						placeholder="Group name"
						disabled={sheetLocked}
						aria-invalid={groupLabelInvalid}
						oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
							groupLabelBuffer = e.currentTarget.value;
						}}
						onblur={commitGroupLabel}
						onkeydown={handleEnterBlur}
					/>
				</div>

				{#if sheetInputHandles.length > 0}
					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">Inputs</span>
						{#each sheetInputHandles as handle (handle.id)}
							<div class="flex items-center gap-2">
								<span class="text-muted-foreground w-16 shrink-0 text-xs"
									>{handle.type}</span
								>
								<Input.Root
									value={handleLabelValue(handle.id)}
									disabled={sheetLocked}
									oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
										handleLabelBuffer[handle.id] = e.currentTarget.value;
									}}
									onblur={() => {
										if (sheetGroupNode.group && sheetInputNodeId) {
											commitHandleLabel(
												sheetGroupNode.group.definitionRef,
												sheetInputNodeId,
												handle.id,
												handleLabelBuffer[handle.id] ?? "",
											);
										}
									}}
									onkeydown={handleEnterBlur}
								/>
								{#if !sheetLocked}
									<Button
										variant="ghost"
										size="icon"
										class="size-8 shrink-0"
										onclick={() => {
											if (sheetGroupNode.group && sheetInputNodeId) {
												graph.removeHandle(
													sheetGroupNode.group.definitionRef,
													sheetInputNodeId,
													handle.id,
												);
											}
										}}
									>
										-
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				{#if sheetOutputHandles.length > 0}
					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">Outputs</span>
						{#each sheetOutputHandles as handle (handle.id)}
							<div class="flex items-center gap-2">
								<span class="text-muted-foreground w-16 shrink-0 text-xs"
									>{handle.type}</span
								>
								<Input.Root
									value={handleLabelValue(handle.id)}
									disabled={sheetLocked}
									oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
										handleLabelBuffer[handle.id] = e.currentTarget.value;
									}}
									onblur={() => {
										if (sheetGroupNode.group && sheetOutputNodeId) {
											commitHandleLabel(
												sheetGroupNode.group.definitionRef,
												sheetOutputNodeId,
												handle.id,
												handleLabelBuffer[handle.id] ?? "",
											);
										}
									}}
									onkeydown={handleEnterBlur}
								/>
								{#if !sheetLocked}
									<Button
										variant="ghost"
										size="icon"
										class="size-8 shrink-0"
										disabled={sheetOutputHandles.length <= 1}
										onclick={() => {
											if (sheetGroupNode.group && sheetOutputNodeId) {
												graph.removeHandle(
													sheetGroupNode.group.definitionRef,
													sheetOutputNodeId,
													handle.id,
												);
											}
										}}
									>
										-
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
