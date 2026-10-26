<script lang="ts">
	import {
		addMenuEntries,
		type AddMenuEntry,
		generateShader,
		type HydratedGraphDocument,
		type HydratedGraphProject,
		isZoneNodeType,
		type NodeGeometry,
		type PendingConnection,
		type ShaderSource,
		reachableShaderHash,
	} from "$core";

	import "../styles/xy-theme.css";
	import { cn } from "$theme";
	import {
		SvelteFlow,
		useSvelteFlow,
		Controls,
		Background,
		type Edge,
		type EdgeTypes,
		type Node,
		type Connection,
		type OnConnectEnd,
	} from "@xyflow/svelte";
	import { mode } from "mode-watcher";
	import { tick, untrack } from "svelte";

	import { getDevTools } from "../dev-tools.svelte";
	import { setDocumentView } from "../document-view";
	import { measureInternalNode } from "../geometry/measure";
	import { getGraphManager } from "../graph-manager.svelte";
	import { openContextMenuAt } from "../utils";
	import AddNodeMenu from "./AddNodeMenu.svelte";
	import DocumentMeasurer from "./DocumentMeasurer.svelte";
	import GradientEdge from "./GradientEdge.svelte";
	import GroupSheet from "./GroupSheet.svelte";
	import { nodeTypes } from "./node-types";
	import ZoneBubbles from "./ZoneBubbles.svelte";
	import ZoneSheet from "./ZoneSheet.svelte";

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

	setDocumentView({
		get document() {
			return graph.activeDocument;
		},
		get locked() {
			return graph.isLocked;
		},
	});

	/** Documents drawn out of sight to be measured, with who's waiting for it. */
	let measuring = $state.raw<
		{
			key: number;
			document: HydratedGraphDocument;
			resolve: (geometry: Map<string, NodeGeometry>) => void;
		}[]
	>([]);
	let measuringKey = 0;

	function measureDocument(definitionRef: string): Promise<Map<string, NodeGeometry>> {
		const document = graph.project.definitions.get(definitionRef);
		if (!document) return Promise.resolve(new Map<string, NodeGeometry>());
		const key = measuringKey++;
		return new Promise<Map<string, NodeGeometry>>((resolve) => {
			measuring = [...measuring, { key, document, resolve }];
		}).finally(() => {
			measuring = measuring.filter((m) => m.key !== key);
		});
	}

	$effect(() => {
		graph.canvas = {
			measure: (node) => measureInternalNode(getInternalNode(node.id)),
			measureDocument,
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

{#each measuring as { key, document, resolve } (key)}
	<DocumentMeasurer {document} onmeasured={resolve} />
{/each}

<svelte:window onkeydown={handleKeydown} />

<ZoneSheet />
<GroupSheet />
