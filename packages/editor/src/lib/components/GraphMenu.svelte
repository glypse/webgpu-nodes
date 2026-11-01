<script lang="ts">
	import { ContextMenu } from "$theme";
	import { useSvelteFlow } from "@xyflow/svelte";
	import type { Snippet } from "svelte";

	import { getGraphManager } from "../graph-manager.svelte";
	import { getGraphView } from "../graph-view.svelte";

	let {
		onadd,
		onduplicate,
		onmove,
		children,
	}: {
		/** Open the add menu at a point (client coordinates). */
		onadd: (x: number, y: number) => void;
		/** Duplicate the selected nodes. */
		onduplicate: () => void;
		/** Grab the selected nodes, to move them with the pointer. */
		onmove: () => void;
		/** The area right-clicking opens the menu on. */
		children: Snippet;
	} = $props();

	const graph = getGraphManager();
	const view = getGraphView();
	const { screenToFlowPosition } = useSvelteFlow();

	/** Where the menu was opened, in client coordinates. */
	let at = { x: 0, y: 0 };
	/** The node it was opened on, if not on the canvas. */
	let onNode = $state<string | undefined>();

	const selected = $derived(view.selectedNodeIds);
	const locked = $derived(view.locked);
	const reroutes = $derived(
		selected.flatMap((id) => {
			const node = view.document.nodesById.get(id);
			return node?.type === "reroute" ? [node] : [];
		}),
	);

	/** A reroute whose links get hidden is named by its tags: an unnamed one asks for a name. */
	function toggleHiddenLinks() {
		graph.toggleHiddenLinks(selected);
		const unnamed = reroutes.find((n) => n.data.label === undefined);
		if (unnamed && graph.resolveNode(unnamed.id)?.data.hideLinks) graph.openSheet(unnamed.id);
	}

	const allUnlinkedHidden = $derived(
		selected.every((id) => view.document.nodesById.get(id)?.data.hideUnlinked === true),
	);
	const inFrame = $derived.by(() => {
		const { frameOf } = graph.frameAnalysis(view.document);
		return selected.some((id) => frameOf.has(id));
	});

	function handleContextMenu(event: MouseEvent) {
		at = { x: event.clientX, y: event.clientY };
		const target = event.target instanceof Element ? event.target : null;
		const nodeId = target?.closest<HTMLElement>(".svelte-flow__node")?.dataset.id;
		onNode = nodeId;
		// A node right-clicked outside the selection becomes the selection.
		if (nodeId && !selected.includes(nodeId)) graph.selectNodes([nodeId]);
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger class="block size-full select-none" oncontextmenu={handleContextMenu}>
		{@render children()}
	</ContextMenu.Trigger>
	<ContextMenu.Content class="w-52">
		{#if onNode}
			{@const nodeId = onNode}
			<ContextMenu.Item disabled={locked} onSelect={() => graph.previewNode(nodeId)}>
				Preview
				<ContextMenu.Shortcut>⇧⌘Click</ContextMenu.Shortcut>
			</ContextMenu.Item>
			<ContextMenu.Separator />
		{:else}
			<ContextMenu.Item disabled={locked} onSelect={() => onadd(at.x, at.y)}>
				Add…
				<ContextMenu.Shortcut>⇧A</ContextMenu.Shortcut>
			</ContextMenu.Item>
			<ContextMenu.Separator />
		{/if}
		{#if selected.length > 0}
			<ContextMenu.Item disabled={locked} onSelect={() => graph.cut(selected)}>
				Cut
			</ContextMenu.Item>
			<ContextMenu.Item onSelect={() => graph.copy(selected)}>
				Copy
				<ContextMenu.Shortcut>⌘C</ContextMenu.Shortcut>
			</ContextMenu.Item>
		{/if}
		<ContextMenu.Item
			disabled={locked || !graph.clipboard}
			onSelect={() => graph.paste(screenToFlowPosition(at))}
		>
			Paste
			<ContextMenu.Shortcut>⌘V</ContextMenu.Shortcut>
		</ContextMenu.Item>
		{#if selected.length > 0}
			<ContextMenu.Item disabled={locked} onSelect={onmove}>
				Move
				<ContextMenu.Shortcut>G</ContextMenu.Shortcut>
			</ContextMenu.Item>
			<ContextMenu.Item disabled={locked} onSelect={onduplicate}>
				Duplicate
				<ContextMenu.Shortcut>⇧D</ContextMenu.Shortcut>
			</ContextMenu.Item>
			{#if reroutes.length > 0}
				<ContextMenu.Item disabled={locked} onSelect={toggleHiddenLinks}>
					{reroutes.every((n) => n.data.hideLinks === true) ? "Show links" : "Hide links"}
				</ContextMenu.Item>
			{/if}
			<ContextMenu.Item
				disabled={locked}
				onSelect={() => graph.toggleUnlinkedSockets(selected)}
			>
				{allUnlinkedHidden ? "Show all sockets" : "Hide unlinked sockets"}
				<ContextMenu.Shortcut>⌃H</ContextMenu.Shortcut>
			</ContextMenu.Item>
			<ContextMenu.Separator />
			<ContextMenu.Item
				disabled={locked}
				variant="destructive"
				onSelect={() => graph.deleteNodes(selected, view.selectedEdgeIds)}
			>
				Delete
				<ContextMenu.Shortcut>⌫</ContextMenu.Shortcut>
			</ContextMenu.Item>
			<ContextMenu.Item disabled={locked} onSelect={() => graph.dissolveNodes(selected)}>
				Dissolve
				<ContextMenu.Shortcut>⌘⌫</ContextMenu.Shortcut>
			</ContextMenu.Item>
		{/if}
		{#if selected.length > 0}
			<ContextMenu.Separator />
			<ContextMenu.Item disabled={locked} onSelect={() => graph.frameNodes(selected)}>
				Frame selected
				<ContextMenu.Shortcut>⌘J</ContextMenu.Shortcut>
			</ContextMenu.Item>
			{#if inFrame}
				<ContextMenu.Item
					disabled={locked}
					onSelect={() => graph.removeFromFrame(selected)}
				>
					Remove from frame
					<ContextMenu.Shortcut>⌥P</ContextMenu.Shortcut>
				</ContextMenu.Item>
			{/if}
		{/if}
		{#if selected.length > 1}
			<ContextMenu.Item
				disabled={locked}
				onSelect={() => graph.groupSelection(new Set(selected))}
			>
				Group selected
				<ContextMenu.Shortcut>⌘G</ContextMenu.Shortcut>
			</ContextMenu.Item>
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>
