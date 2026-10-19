<script lang="ts">
	import { Button, ContextMenu, Input, Sheet, cn } from "$theme";

	import "./xy-theme.css";
	import {
		SvelteFlow,
		useSvelteFlow,
		Controls,
		Background,
		type Edge,
		type EdgeTypes,
		type Node,
	} from "@xyflow/svelte";
	import { mode } from "mode-watcher";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import { tick } from "svelte";

	import { generateShader, reachableShaderHash } from "./codegen";
	import GradientEdge from "./GradientEdge.svelte";
	import { getGraphManager } from "./graph-state.svelte";
	import { type HydratedGraphProject, ROOT_ID } from "./graph-types";
	import { type HydratedGraphDocument } from "./hydrated-document.svelte";
	import NodeShell from "./NodeShell.svelte";
	import { nodeRegistry, defaultDataForType, DYNAMIC_NODE_TYPES } from "./registry";
	import { type HandleDef, type NodeCategory } from "./types";
	import { getDevContext } from "./utils";
	import ZoneBubbles from "./ZoneBubbles.svelte";
	import { isZoneNodeType } from "./zones";
	import ZoneSheet from "./ZoneSheet.svelte";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow node types accept any component
	const nodeTypes: Record<string, any> = {};
	for (const type of [...Object.keys(nodeRegistry), ...DYNAMIC_NODE_TYPES]) {
		nodeTypes[type] = NodeShell;
	}

	const edgeTypes: EdgeTypes = {
		gradient: GradientEdge,
	};

	let debug = getDevContext();

	let {
		class: className,
		wrapperClass,
		nodes = $bindable([]),
		edges = $bindable([]),
		frag = $bindable(""),
	}: {
		class?: string;
		wrapperClass?: string;
		nodes?: Node[];
		edges?: Edge[];
		frag?: string;
	} = $props();

	const categoryMap = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- static data, never mutated after creation
		const map = new Map<
			NodeCategory,
			{ id: string; label: string; fromLibrary: boolean; zone?: boolean }[]
		>([
			["zone", [{ id: "repeat-zone", label: "Repeat Zone", fromLibrary: false, zone: true }]],
		]);
		for (const [type, desc] of Object.entries(nodeRegistry)) {
			if (desc.hidden) continue;
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

	const { screenToFlowPosition, getNodes, getViewport, setViewport, fitView } = useSvelteFlow();
	const graph = getGraphManager();

	// ── Per-document viewport (pan/zoom) persistence ──────────────────────────
	// Each graph document (root + every group definition) stores its own camera so
	// navigating between subgraphs restores the previous view instead of sharing a
	// single global viewport. A document with no stored viewport falls back to
	// fitView the first time it is entered, then keeps whatever the user leaves it at.
	let prevPathKey = $state("");
	let prevProject: HydratedGraphProject | null = null;
	let prevDoc: HydratedGraphDocument | null = null;

	async function applyActiveViewport() {
		const doc = graph.activeDocument;
		// Wait for the DOM to swap in the new document's nodes, then give SvelteFlow
		// a frame to measure them before restoring the camera or fitting.
		await tick();
		requestAnimationFrame(() => {
			if (doc.viewport) {
				void setViewport(doc.viewport);
			} else {
				void fitView();
			}
		});
	}

	$effect(() => {
		const pathKey = graph.path.join("|");
		const project = graph.project;
		const projectChanged = prevProject !== project;
		if (prevDoc && prevPathKey !== pathKey && !projectChanged) {
			// Capture the camera of the document we're leaving before it's lost.
			prevDoc.viewport = { ...getViewport() };
		}
		prevPathKey = pathKey;
		prevProject = project;
		prevDoc = graph.activeDocument;
		void applyActiveViewport();
	});

	const userGroups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- static data, never mutated after creation
		const seen = new Set<string>();
		const stdIds = new Set(graph.library.map((e) => e.id));
		const groups: { definitionRef: string; label: string; used: boolean }[] = [];

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
					const def = graph.project.definitions.get(node.group.definitionRef);
					groups.push({
						definitionRef: node.group.definitionRef,
						label: def?.label ?? "Group",
						used: true,
					});
				}
			}
		}

		for (const def of graph.project.definitions.values()) {
			collectFromDoc(def);
		}

		// Also include definitions that exist in the project but aren't referenced
		// by any node-group in the graph (e.g. imported from JSON but not yet placed).
		for (const defRef of graph.project.definitions.keys()) {
			if (seen.has(defRef) || stdIds.has(defRef) || defRef === ROOT_ID) continue;
			seen.add(defRef);
			const def = graph.project.definitions.get(defRef);
			groups.push({ definitionRef: defRef, label: def?.label ?? "Group", used: false });
		}

		return groups;
	});

	const isLocked = $derived(graph.isLocked);

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
		graph.rebuildTypeCache();
	}

	function addFromLibrary(definitionRef: string) {
		const position = screenToFlowPosition({
			x: contextMenuPosition.x,
			y: contextMenuPosition.y,
		});
		graph.addFromLibrary(definitionRef, position);
	}

	function createRepeatZone() {
		const position = screenToFlowPosition({
			x: contextMenuPosition.x,
			y: contextMenuPosition.y,
		});
		graph.createRepeatZone(position);
	}

	function createGroup() {
		const position = screenToFlowPosition({
			x: contextMenuPosition.x,
			y: contextMenuPosition.y,
		});
		graph.createGroup(position);
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
			if (graph.zoneSheetId) {
				event.preventDefault();
				graph.zoneSheetId = null;
			} else if (graph.sheetOpen) {
				event.preventDefault();
				graph.sheetOpen = false;
			} else if (graph.path.length > 0) {
				event.preventDefault();
				graph.exitGroup();
			}
		} else if (event.key === "n" && !event.metaKey && !event.ctrlKey) {
			const selectedZoneNode = getNodes().find((n) => n.selected && isZoneNodeType(n.type));
			if (selectedZoneNode) {
				event.preventDefault();
				graph.openZoneSheet(selectedZoneNode.id);
				return;
			}
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
				let current = graph.root;
				for (const nodeId of graph.path) {
					const node = current.nodes.find((n) => n.id === nodeId);
					if (!node?.group) break;
					targetNodeId = nodeId;
					const def = graph.project.definitions.get(node.group.definitionRef);
					if (!def) break;
					current = def;
				}
			}

			if (targetNodeId) {
				event.preventDefault();
				graph.openGroupSheet(targetNodeId);
			} else if (graph.sheetOpen) {
				graph.sheetOpen = false;
			}
		} else if (event.code === "KeyG" && !event.metaKey && !event.ctrlKey && !event.altKey) {
			if (isLocked) return;
			event.preventDefault();
			const selectedIds = new Set(
				getNodes()
					.filter((node) => node.selected)
					.map((node) => node.id),
			);
			if (selectedIds.size < 1) return;
			if (event.shiftKey) {
				graph.ungroupSelection(selectedIds);
			} else {
				graph.groupSelection(selectedIds);
			}
		} else if (event.key === "Delete" || event.key === "Backspace") {
			if (isLocked) {
				event.preventDefault();
			}
		}
	}

	// Track the shader-relevant hash to avoid rebuilding on position changes.
	// Only hash the reachable subgraph so edits to disconnected nodes or unused
	// group definitions don't trigger unnecessary shader regeneration.
	let prevHash = $state("");

	$effect(() => {
		const hash = reachableShaderHash(graph.project);
		if (hash === prevHash) return;
		prevHash = hash;
		try {
			frag = generateShader(graph).shader;
		} catch (error) {
			// Keep the last valid shader (e.g. the graph briefly contains a cycle).
			console.error("[shader] generation failed", error);
			return;
		}

		if (debug) {
			/* const sortedIds = debugSort(rootNodes, rootEdges); */
			console.groupCollapsed("[shader debug]");
			console.log("// Compiled fragment shader:\n", frag);
			/* console.log("Sorted order:\n", sortedIds.join("\n"));
			console.log(JSON.parse(graph.getProjectJson())); */
			console.groupEnd();
		}
	});

	// Close the group config sheet when selection no longer contains a group node.
	$effect(() => {
		const _ids = graph.selectedNodeIds;
		if (!graph.sheetOpen) return;
		// Keep the sheet open when we're inside a group (viewing its contents).
		if (graph.path.length > 0) return;
		const hasGroup = _ids.some((id) => {
			const node = graph.activeDocument.nodes.find((n) => n.id === id);
			return node?.type === "node-group" && node.group;
		});
		if (!hasGroup) {
			graph.sheetOpen = false;
		}
	});

	const CATEGORY_LABELS: Record<NodeCategory, string> = {
		input: "Input",
		math: "Math",
		vector: "Vector",
		logic: "Logic",
		integer: "Integer",
		converter: "Converter",
		zone: "Zones",
		color: "Color",
		misc: "Miscellaneous",
	};

	function handleContextMenu(e: MouseEvent) {
		contextMenuPosition = { x: e.clientX, y: e.clientY };
	}

	const sheetGroupNode = $derived.by(() => {
		if (!graph.sheetGroupId) return undefined;
		if (graph.path.length > 0) {
			const inParent = graph.parentDocument.nodes.find((n) => n.id === graph.sheetGroupId);
			if (inParent) return inParent;
		}
		return graph.activeDocument.nodes.find((n) => n.id === graph.sheetGroupId);
	});
	const sheetDefinition = $derived(
		sheetGroupNode?.group
			? graph.project.definitions.get(sheetGroupNode.group.definitionRef)
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
		if (graph.sheetGroupId && groupLabelBuffer.trim()) {
			graph.setGroupLabel(graph.sheetGroupId, groupLabelBuffer);
		}
	}

	function commitHandleLabel(defRef: string, nodeId: string, handleId: string, value: string) {
		if (value.trim()) {
			const accepted = graph.setHandleLabel(defRef, nodeId, handleId, value);
			if (!accepted) {
				// Revert buffer to the stored label so the input reflects the actual value
				const labels = graph.resolveNodeLabels(nodeId);
				const stored = labels.outputs[handleId] ?? labels.inputs[handleId];
				if (stored) handleLabelBuffer[handleId] = stored;
			}
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
<div oncontextmenu={handleContextMenu} class={cn("size-full", wrapperClass)}>
	<ContextMenu.Root>
		<ContextMenu.Trigger class="block size-full">
			<SvelteFlow
				bind:nodes
				bind:edges
				{nodeTypes}
				{edgeTypes}
				defaultEdgeOptions={{ type: "gradient" }}
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
				onbeforedelete={({ nodes: deletedNodes, edges: deletedEdges }) =>
					Promise.resolve(
						isLocked ? false : graph.expandDeletion(deletedNodes, deletedEdges),
					)}
				isValidConnection={(connection) => graph.isValidConnection(connection)}
				onmove={(_event, viewport) => {
					graph.activeDocument.viewport = { ...viewport };
				}}
				onconnect={(connection) => {
					const { source, target, sourceHandle, targetHandle } = connection;
					if (!source || !target || !sourceHandle || !targetHandle) return;

					// Dropped on a zone's virtual socket: create the state item first.
					if (graph.connectNewZoneItem({ source, target, sourceHandle, targetHandle })) {
						return;
					}

					const edge = {
						...connection,
						id: crypto.randomUUID(),
						sourceHandle,
						targetHandle,
						type: "gradient",
					};

					// Skip replacement logic for variadic inputs — they accept many edges.
					const targetNode = nodes.find((n) => n.id === target);
					if (targetNode) {
						const descriptor = graph.resolveDescriptor(targetNode);
						const inputDef = descriptor.inputs.find((i) => i.id === targetHandle);
						if (inputDef?.variadic) {
							edges = [
								...edges.filter(
									(e) =>
										!(
											e.source === source &&
											e.sourceHandle === sourceHandle &&
											e.target === target &&
											e.targetHandle === targetHandle
										),
								),
								edge,
							];
							return;
						}
					}

					// Single source of data per non-variadic input: drop any existing
					// edge into the same target handle, then add the new one.
					edges = [
						...edges.filter(
							(e) => !(e.target === target && e.targetHandle === targetHandle),
						),
						edge,
					];
				}}
				onselectionchange={({ nodes: selectedNodes }) => {
					graph.selectedNodeIds = selectedNodes.map((n) => n.id);
				}}
			>
				<ZoneBubbles />
				<Controls showLock={false} showZoom={false} />
				<Background class="bg-background" />
			</SvelteFlow>
		</ContextMenu.Trigger>

		<ContextMenu.Content class="w-20">
			{#each [...categoryMap.entries()] as [category, items] (category)}
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>{CATEGORY_LABELS[category]}</ContextMenu.SubTrigger>
					<ContextMenu.SubContent>
						{#each items as item (item.id)}
							<ContextMenu.Item
								disabled={graph.wouldCreateCycle(item.id)}
								onclick={() => {
									if (item.zone) {
										createRepeatZone();
									} else if (item.id === "node-group") {
										createGroup();
									} else if (item.fromLibrary) {
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
								{#if !group.used}
									<Button
										variant="destructive"
										size="icon-sm"
										class="ml-auto"
										onclick={(e: MouseEvent) => {
											e.stopPropagation();
											graph.deleteDefinition(group.definitionRef);
										}}
									>
										<TrashIcon />
									</Button>
								{/if}
							</ContextMenu.Item>
						{/each}
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
</div>

<svelte:window onkeydown={handleKeydown} />

<ZoneSheet />

<Sheet.Root bind:open={graph.sheetOpen}>
	<Sheet.Content
		class="w-[350px] sm:w-[400px]"
		onOpenAutoFocus={(e: Event) => e.preventDefault()}
		escapeKeydownBehavior="ignore"
	>
		<Sheet.Header>
			<Sheet.Title>Group settings</Sheet.Title>
		</Sheet.Header>
		{#if sheetGroupNode && sheetDefinition}
			<div class="flex flex-col gap-4 p-4">
				<Button
					variant="outline"
					onclick={() => {
						if (graph.sheetGroupId) {
							graph.deepClone(graph.sheetGroupId);
						}
					}}
				>
					Clone & Edit
				</Button>

				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">Group Label</span>
					<Input
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
								<Input
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
								<Input
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
