<script lang="ts">
	import { ContextMenu } from "$theme";
	import { useSvelteFlow } from "@xyflow/svelte";
	import type { Snippet } from "svelte";

	import { getGraphManager } from "../graph-manager.svelte";
	import { getGraphView } from "../graph-view.svelte";

	let {
		onadd,
		onduplicate,
		children,
	}: {
		/** Open the add menu at a point (client coordinates). */
		onadd: (x: number, y: number) => void;
		/** Duplicate the selected nodes. */
		onduplicate: () => void;
		/** The area right-clicking opens the menu on. */
		children: Snippet;
	} = $props();

	const graph = getGraphManager();
	const view = getGraphView();
	const { screenToFlowPosition } = useSvelteFlow();

	/** Where the menu was opened, in client coordinates. */
	let at = { x: 0, y: 0 };
	/** Whether it was opened on a node rather than the canvas. */
	let onNode = $state(false);

	const selected = $derived(view.selectedNodeIds);
	const locked = $derived(view.locked);

	function handleContextMenu(event: MouseEvent) {
		at = { x: event.clientX, y: event.clientY };
		const target = event.target instanceof Element ? event.target : null;
		const nodeId = target?.closest<HTMLElement>(".svelte-flow__node")?.dataset.id;
		onNode = nodeId !== undefined;
		// A node right-clicked outside the selection becomes the selection.
		if (nodeId && !selected.includes(nodeId)) graph.selectNodes([nodeId]);
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger class="block size-full select-none" oncontextmenu={handleContextMenu}>
		{@render children()}
	</ContextMenu.Trigger>
	<ContextMenu.Content class="w-52">
		{#if !onNode}
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
			<ContextMenu.Item disabled={locked} onSelect={onduplicate}>
				Duplicate
				<ContextMenu.Shortcut>⇧D</ContextMenu.Shortcut>
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
		{#if selected.length > 1}
			<ContextMenu.Separator />
			<ContextMenu.Item
				disabled={locked}
				onSelect={() => graph.groupSelection(new Set(selected))}
			>
				Group selected
				<ContextMenu.Shortcut>G</ContextMenu.Shortcut>
			</ContextMenu.Item>
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>
