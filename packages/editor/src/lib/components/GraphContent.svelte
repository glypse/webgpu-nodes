<script lang="ts">
	import {
		addMenuEntries,
		type AddMenuEntry,
		DYNAMIC_NODE_TYPES,
		generateShader,
		handlesOf,
		type HydratedGraphDocument,
		type HydratedGraphProject,
		isZoneNodeType,
		type NodeGeometry,
		nodeRegistry,
		type PendingConnection,
		type ShaderSource,
		reachableShaderHash,
		WGSL_TYPES,
		type WgslType,
	} from "$core";

	import "../styles/xy-theme.css";
	import { Button, Input, Sheet, cn } from "$theme";
	import {
		SvelteFlow,
		useSvelteFlow,
		Controls,
		Background,
		type Edge,
		type EdgeTypes,
		type InternalNode,
		type Node,
		type Connection,
		type OnConnectEnd,
	} from "@xyflow/svelte";
	import { mode } from "mode-watcher";
	import { tick, untrack } from "svelte";

	import { getDevTools } from "../dev-tools.svelte";
	import { getGraphManager } from "../graph-manager.svelte";
	import { openContextMenuAt } from "../utils";
	import AddNodeMenu from "./AddNodeMenu.svelte";
	import GradientEdge from "./GradientEdge.svelte";
	import NodeShell from "./NodeShell.svelte";
	import TypePicker from "./TypePicker.svelte";
	import ZoneBubbles from "./ZoneBubbles.svelte";
	import ZoneSheet from "./ZoneSheet.svelte";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow node types accept any component
	const nodeTypes: Record<string, any> = {};
	for (const type of [...Object.keys(nodeRegistry), ...DYNAMIC_NODE_TYPES]) {
		nodeTypes[type] = NodeShell;
	}

	const edgeTypes: EdgeTypes = {
		gradient: GradientEdge,
	};

	const devTools = getDevTools();

	let {
		class: className,
		wrapperClass,
		nodes = $bindable([]),
		edges = $bindable([]),
		shader = $bindable(),
	}: {
		class?: string;
		wrapperClass?: string;
		nodes?: Node[];
		edges?: Edge[];
		shader?: ShaderSource;
	} = $props();

	const { screenToFlowPosition, getNodes, getViewport, setViewport, fitView, getInternalNode } =
		useSvelteFlow();
	const graph = getGraphManager();

	type HandleBounds = NonNullable<InternalNode["internals"]["handleBounds"]>;

	/** A node's size and handle offsets as SvelteFlow measured them. */
	function measureNode(nodeId: string): NodeGeometry | undefined {
		const internal = getInternalNode(nodeId);
		const width = internal?.measured.width;
		const height = internal?.measured.height;
		if (!internal || width === undefined || height === undefined) return undefined;
		const offsets = (handles: HandleBounds["source"] | undefined) =>
			new Map(
				(handles ?? []).flatMap((h) => (h.id ? [[h.id, h.y + h.height / 2] as const] : [])),
			);
		const bounds = internal.internals.handleBounds;
		return { width, height, inputs: offsets(bounds?.target), outputs: offsets(bounds?.source) };
	}

	$effect(() => {
		graph.canvas = {
			measure: (node) => measureNode(node.id),
			fitView: async () => {
				await tick();
				await fitView({ duration: 300 });
			},
		};
		return () => {
			graph.canvas = null;
		};
	});

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

	const isLocked = $derived(graph.isLocked);

	// ── Add menu ───────────────────────────────────────────────────────────
	// Right-click (or Shift+A) opens the add menu at the pointer; the picked
	// entry is created where the menu was opened. When a link is dropped on
	// empty space, the menu only lists what can take it, and the picked node
	// gets linked.
	/** The add menu's trigger, which opening events are dispatched on. */
	let addMenuTrigger = $state<HTMLElement | null>(null);
	let addMenuOpen = $state<boolean>(false);
	let addMenuAt = $state<{ x: number; y: number; pending: PendingConnection | null }>({
		x: 0,
		y: 0,
		pending: null,
	});
	/** Connection to attach to the next opening (set by `openAddMenu`). */
	let nextPending: PendingConnection | null = null;

	const addEntries = $derived.by(() => {
		if (!addMenuOpen) return [];
		const entries = addMenuEntries(graph, { devTools: devTools.enabled });
		const pending = addMenuAt.pending;
		if (!pending) return entries;
		return graph.connectableEntries(entries, pending);
	});

	const addMenuPlaceholder = $derived.by(() => {
		const pending = addMenuAt.pending;
		if (!pending) return "Search nodes…";
		if (pending.handleType === "source") {
			const type = graph.resolveOutputHandleType(pending.nodeId, pending.handleId);
			return `Nodes taking a ${type}…`;
		}
		const type = graph.resolveInputType(pending.nodeId, pending.handleId);
		return `Nodes producing a ${type}…`;
	});

	/** Open the add menu at a point, as a right-click there would. */
	function openAddMenu(x: number, y: number, pending: PendingConnection | null = null) {
		if (isLocked) return;
		nextPending = pending;
		if (addMenuTrigger) openContextMenuAt(addMenuTrigger, x, y);
	}

	/** Every opening (real right-click or `openAddMenu`) goes through here. */
	function handleContextMenu(e: MouseEvent) {
		addMenuAt = { x: e.clientX, y: e.clientY, pending: nextPending };
		nextPending = null;
	}

	function pickAddEntry(entry: AddMenuEntry) {
		const position = screenToFlowPosition({ x: addMenuAt.x, y: addMenuAt.y });
		if (addMenuAt.pending) graph.addMenuEntryConnected(entry, position, addMenuAt.pending);
		else graph.addMenuEntry(entry, position);
	}

	function handleConnect(connection: Connection) {
		const { source, target, sourceHandle, targetHandle } = connection;
		if (!sourceHandle || !targetHandle) return;
		graph.connect({ source, target, sourceHandle, targetHandle });
	}

	/** A link dropped on empty space opens the add menu for what can take it. */
	const handleConnectEnd: OnConnectEnd = (event, state) => {
		if (state.toHandle || !state.fromHandle?.id) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".svelte-flow__node")) return;
		const point = "changedTouches" in event ? event.changedTouches[0] : event;
		if (!point) return;
		openAddMenu(point.clientX, point.clientY, {
			nodeId: state.fromNode.id,
			handleId: state.fromHandle.id,
			handleType: state.fromHandle.type,
		});
	};

	function deleteGroupEntry(entry: AddMenuEntry) {
		if (entry.definitionRef) graph.deleteDefinition(entry.definitionRef);
	}

	/** Last pointer position over the graph, for keyboard-opened menus. */
	let pointer = { x: 0, y: 0 };

	function handleKeydown(event: KeyboardEvent) {
		const tag = (event.target as HTMLElement | null)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA") return;

		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		if (mod && key === "z") {
			event.preventDefault();
			if (event.shiftKey) graph.redo();
			else graph.undo();
			return;
		}
		if (mod && key === "y") {
			event.preventDefault();
			graph.redo();
			return;
		}
		if (event.shiftKey && !mod && !event.altKey && key === "a") {
			event.preventDefault();
			openAddMenu(pointer.x, pointer.y);
			return;
		}

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

	// Undo history: record a step once the documents stop changing for a
	// moment, so a drag or a scrub becomes one step. Node/edge arrays are
	// reassigned on every change, which is what this effect tracks.
	const HISTORY_DEBOUNCE_MS = 300;
	$effect(() => {
		const tracked = [...graph.project.definitions.values()].map((doc) => [
			doc.nodes,
			doc.edges,
			doc.label,
			doc.locked,
		]);
		if (tracked.length === 0) return;
		const timer = setTimeout(() => {
			graph.recordHistory();
		}, HISTORY_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
		};
	});

	// Track the shader-relevant hash to avoid regenerating on position changes.
	// Only hash the reachable subgraph so edits to disconnected nodes or unused
	// group definitions don't trigger unnecessary shader regeneration.
	let prevHash = "";

	// The values of the document in view are uniforms: editing them only
	// changes the uniforms, while the fragment (and its compiled pipeline)
	// stays the same.
	$effect(() => {
		const uniformScope = graph.isLocked ? undefined : graph.activeDefinitionRef;
		const hash = `${uniformScope ?? ""}|${reachableShaderHash(graph.project)}`;
		if (hash === prevHash) return;
		prevHash = hash;
		let generated: ReturnType<typeof generateShader>;
		try {
			generated = generateShader(graph, { uniformScope });
		} catch (error) {
			// Keep the last valid shader (e.g. the graph briefly contains a cycle).
			console.error("[shader] generation failed", error);
			return;
		}
		const fragmentChanged = generated.shader !== untrack(() => shader?.fragment);
		shader = { fragment: generated.shader, uniforms: generated.uniforms };

		if (devTools.enabled && fragmentChanged) {
			/* const sortedIds = debugSort(rootNodes, rootEdges); */
			console.groupCollapsed("[shader debug]");
			console.log("// Compiled fragment shader:\n", generated.shader);
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
		return handlesOf(inputNode);
	});
	const sheetOutputHandles = $derived.by(() => {
		if (!sheetDefinition) return [];
		const outputNode = sheetDefinition.nodes.find((n) => n.type === "group-output");
		return handlesOf(outputNode);
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
<div
	oncontextmenu={handleContextMenu}
	onpointermove={(e) => {
		pointer = { x: e.clientX, y: e.clientY };
	}}
	class={cn("size-full", wrapperClass)}
>
	<AddNodeMenu
		bind:trigger={addMenuTrigger}
		bind:open={addMenuOpen}
		disabled={isLocked}
		entries={addEntries}
		placeholder={addMenuPlaceholder}
		onpick={pickAddEntry}
		ondelete={deleteGroupEntry}
	>
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
			proOptions={{ hideAttribution: !devTools.enabled }}
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
			onconnect={handleConnect}
			onconnectend={handleConnectEnd}
			onselectionchange={({ nodes: selectedNodes }) => {
				graph.selectedNodeIds = selectedNodes.map((n) => n.id);
			}}
		>
			<ZoneBubbles />
			<Controls showLock={false} showZoom={false} />
			<Background class="bg-background" />
		</SvelteFlow>
	</AddNodeMenu>
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
								<TypePicker
									types={WGSL_TYPES}
									value={handle.type}
									disabled={sheetLocked}
									class="w-20 shrink-0"
									title="Value type"
									onpick={(type: WgslType) => {
										if (sheetGroupNode.group && sheetInputNodeId) {
											graph.setHandleType(
												sheetGroupNode.group.definitionRef,
												sheetInputNodeId,
												handle.id,
												type,
											);
										}
									}}
								/>
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
								<TypePicker
									types={WGSL_TYPES}
									value={handle.type}
									disabled={sheetLocked}
									class="w-20 shrink-0"
									title="Value type"
									onpick={(type: WgslType) => {
										if (sheetGroupNode.group && sheetOutputNodeId) {
											graph.setHandleType(
												sheetGroupNode.group.definitionRef,
												sheetOutputNodeId,
												handle.id,
												type,
											);
										}
									}}
								/>
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
