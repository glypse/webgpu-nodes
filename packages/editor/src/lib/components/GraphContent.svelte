<script lang="ts">
	import {
		addMenuEntries,
		type AddMenuEntry,
		type HydratedGraphDocument,
		type HydratedGraphProject,
		type NodeGeometry,
		type PendingConnection,
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
	import { measureInternalNode } from "../geometry/measure";
	import { getGraphManager } from "../graph-manager.svelte";
	import { getGraphView } from "../graph-view.svelte";
	import { openContextMenuAt } from "../utils";
	import AddNodeMenu from "./AddNodeMenu.svelte";
	import DocumentMeasurer from "./DocumentMeasurer.svelte";
	import GradientEdge from "./GradientEdge.svelte";
	import GraphMenu from "./GraphMenu.svelte";
	import LinkStroke from "./LinkStroke.svelte";
	import { nodeTypes } from "./node-types";
	import ZoneBubbles from "./ZoneBubbles.svelte";

	const edgeTypes: EdgeTypes = {
		gradient: GradientEdge,
	};

	const devTools = getDevTools();

	let {
		class: className,
		wrapperClass,
		nodes = $bindable([]),
		edges = $bindable([]),
	}: {
		class?: string;
		wrapperClass?: string;
		nodes?: Node[];
		edges?: Edge[];
	} = $props();

	const { screenToFlowPosition, getNodes, getViewport, setViewport, fitView, getInternalNode } =
		useSvelteFlow();
	const graph = getGraphManager();
	const view = getGraphView();

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
		graph.canvases.set(view.areaId, {
			measure: (node) => measureInternalNode(getInternalNode(node.id)),
			measureDocument,
			fitView: async () => {
				await tick();
				await fitView({ duration: 300 });
			},
		});
		return () => {
			graph.canvases.delete(view.areaId);
		};
	});

	// ── Viewport (pan/zoom) persistence ─────────────────────────────────────
	// Each document keeps the camera it was last left at, so entering it again
	// (here or in another area) restores that view instead of sharing one
	// global viewport; one never left is fitted the first time it's entered.
	// The area also keeps its own camera, for the document it shows when the
	// project is saved and opened again.
	let prevPathKey: string | null = null;
	let prevProject: HydratedGraphProject | null = null;
	let prevDoc: HydratedGraphDocument | null = null;

	async function applyViewport(first: boolean) {
		const doc = view.document;
		const viewport = (first ? view.viewport : undefined) ?? doc.viewport;
		// Wait for the DOM to swap in the new document's nodes, then give SvelteFlow
		// a frame to measure them before restoring the camera or fitting.
		await tick();
		requestAnimationFrame(() => {
			if (viewport) {
				void setViewport(viewport);
			} else {
				void fitView();
			}
		});
	}

	const pathKey = $derived(view.path.join("|"));

	// Only a new path or project moves the camera: any other change (e.g. the
	// layout, which this area's camera is saved in) must leave it alone.
	$effect(() => {
		const key = pathKey;
		const project = graph.project;
		untrack(() => {
			const projectChanged = prevProject !== project;
			if (prevDoc && prevPathKey !== key && !projectChanged) {
				// Capture the camera of the document we're leaving before it's lost.
				prevDoc.viewport = { ...getViewport() };
			}
			const first = prevPathKey === null || projectChanged;
			prevPathKey = key;
			prevProject = project;
			prevDoc = view.document;
			void applyViewport(first);
		});
	});

	const isLocked = $derived(view.locked);

	/** Whether the pointer is over this area: keys act on the area under it. */
	let hovered = $state(false);

	// ── Add menu ───────────────────────────────────────────────────────────
	// Shift+A (or Add… in the context menu) opens the add menu at the
	// pointer; the picked entry is created where the menu was opened. When a
	// link is dropped on empty space, the menu only lists what can take it,
	// and the picked node gets linked.
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

	/** Open the add menu at a point. */
	function openAddMenu(x: number, y: number, pending: PendingConnection | null = null) {
		if (isLocked) return;
		nextPending = pending;
		if (addMenuTrigger) openContextMenuAt(addMenuTrigger, x, y);
	}

	/** Every opening of the add menu goes through here. */
	function handleAddMenuOpening(e: MouseEvent) {
		addMenuAt = { x: e.clientX, y: e.clientY, pending: nextPending };
		nextPending = null;
	}

	/** Fields keep the browser's own menu, for their text. */
	function handleContextMenuCapture(e: MouseEvent) {
		const target = e.target instanceof Element ? e.target : null;
		if (target?.closest("input, textarea, [contenteditable]")) e.stopPropagation();
	}

	// ── Duplicate ──────────────────────────────────────────────────────────
	// Duplicates start where their originals are and follow the pointer until
	// a click drops them; a right-click (or Escape) takes them back.
	let grab: {
		ids: string[];
		originals: string[];
		from: Map<string, { x: number; y: number }>;
		start: { x: number; y: number };
	} | null = null;

	function duplicateSelection() {
		const originals = view.selectedNodeIds;
		const ids = graph.duplicateNodes(originals);
		if (ids.length === 0) return;
		const from = new Map(
			view.document.nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, n.position]),
		);
		grab = { ids, originals, from, start: screenToFlowPosition(pointer) };
	}

	function moveGrab() {
		if (!grab) return;
		const at = screenToFlowPosition(pointer);
		graph.moveNodes(grab.from, { x: at.x - grab.start.x, y: at.y - grab.start.y });
	}

	function endGrab(cancel: boolean) {
		if (!grab) return;
		if (cancel) {
			graph.deleteNodes(grab.ids);
			graph.selectNodes(grab.originals);
		}
		grab = null;
	}

	/** Set when a right-click cancels: its context menu mustn't open. */
	let cancelledByRightClick = false;

	function handleWindowPointerDown(e: PointerEvent) {
		pointer = { x: e.clientX, y: e.clientY };
		if (!grab) return;
		e.preventDefault();
		e.stopPropagation();
		cancelledByRightClick = e.button === 2;
		endGrab(e.button !== 0);
	}

	/** Some browsers send the context menu before the press: it cancels too. */
	function handleWindowContextMenu(e: MouseEvent) {
		if (grab) endGrab(true);
		else if (!cancelledByRightClick) return;
		cancelledByRightClick = false;
		e.preventDefault();
		e.stopPropagation();
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

	/** Last pointer position, for keyboard-opened menus and pastes. */
	let pointer = { x: 0, y: 0 };

	function handleKeydown(event: KeyboardEvent) {
		if (grab) {
			if (event.key === "Escape") {
				event.preventDefault();
				endGrab(true);
			}
			return;
		}
		if (!hovered) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest("input, textarea, select, [contenteditable]")) return;
		view.activate();

		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		if (event.shiftKey && !mod && !event.altKey && key === "a") {
			event.preventDefault();
			openAddMenu(pointer.x, pointer.y);
			return;
		}
		if (mod && !event.altKey && !event.shiftKey && (key === "c" || key === "v")) {
			event.preventDefault();
			if (key === "c") graph.copy(view.selectedNodeIds);
			else graph.paste(screenToFlowPosition(pointer));
			return;
		}
		if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			if (mod) graph.dissolveNodes(view.selectedNodeIds);
			else graph.deleteNodes(view.selectedNodeIds, view.selectedEdgeIds);
			return;
		}
		if (key === "d" && event.shiftKey && !mod && !event.altKey) {
			event.preventDefault();
			if (!isLocked) duplicateSelection();
			return;
		}
		if (key === "r" && !mod && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			graph.resetNodes(view.selectedNodeIds);
			return;
		}

		if (event.key === "Enter") {
			const allNodes = getNodes();
			const selected = allNodes.find((n) => n.selected);
			if (!selected) return;

			if (selected.type === "node-group") {
				event.preventDefault();
				view.enterGroup(selected.id);
			}
		} else if (event.key === "Escape") {
			if (graph.sheetNodeId) {
				event.preventDefault();
				graph.sheetNodeId = null;
			} else if (view.path.length > 0) {
				event.preventDefault();
				view.exitGroup();
			}
		} else if (event.key === "n" && !mod) {
			// The selected node's sheet, or that of the group entered.
			const target = view.selectedNodeIds[0] ?? view.path.at(-1);
			event.preventDefault();
			if (target) graph.openSheet(target);
			else graph.sheetNodeId = null;
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
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	oncontextmenu={handleAddMenuOpening}
	oncontextmenucapture={handleContextMenuCapture}
	onpointerdowncapture={() => {
		view.activate();
	}}
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
	class={cn("relative size-full", wrapperClass)}
>
	<AddNodeMenu
		bind:trigger={addMenuTrigger}
		bind:open={addMenuOpen}
		disabled={isLocked}
		entries={addEntries}
		placeholder={addMenuPlaceholder}
		onpick={pickAddEntry}
		ondelete={deleteGroupEntry}
	/>
	<GraphMenu
		onadd={(x: number, y: number) => setTimeout(() => openAddMenu(x, y))}
		onduplicate={duplicateSelection}
	>
		<!-- The flow's id scopes its SVG ids (the background pattern's): areas must not share one. -->
		<SvelteFlow
			id={view.areaId}
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
			deleteKey={null}
			isValidConnection={(connection) => graph.isValidConnection(connection)}
			onmove={(_event, viewport) => {
				view.document.viewport = { ...viewport };
			}}
			onmoveend={(event, viewport) => {
				// Moves of our own (restoring a camera) have no event.
				if (event) view.viewport = { ...viewport };
			}}
			onconnect={handleConnect}
			onconnectend={handleConnectEnd}
			onselectionchange={({ nodes: selectedNodes }) => {
				if (view.active) graph.selectedNodeIds = selectedNodes.map((n) => n.id);
			}}
		>
			<ZoneBubbles />
			<LinkStroke />
			<Controls showLock={false} showZoom={false} />
			<Background class="bg-background" />
		</SvelteFlow>
	</GraphMenu>
</div>

{#each measuring as { key, document, resolve } (key)}
	<DocumentMeasurer {document} onmeasured={resolve} />
{/each}

<svelte:window
	onkeydown={handleKeydown}
	onpointermove={(e: PointerEvent) => {
		pointer = { x: e.clientX, y: e.clientY };
		moveGrab();
	}}
	onpointerdowncapture={handleWindowPointerDown}
	oncontextmenucapture={handleWindowContextMenu}
/>
