<script lang="ts">
	import { isZoneNodeType } from "$core";
	import { Button, Dialog, Input } from "$theme";
	import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwiseIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import GroupSettings from "./GroupSettings.svelte";
	import ZoneSettings from "./ZoneSettings.svelte";

	const graph = getGraphManager();

	const node = $derived(graph.sheetNodeId ? graph.resolveNode(graph.sheetNodeId) : undefined);

	/** Whether the node is in the document in view (or is the group entered there). */
	const inView = $derived(node !== undefined && graph.activeDocument.nodesById.has(node.id));
	const locked = $derived.by(() => {
		if (inView) return graph.isLocked;
		const path = graph.path;
		return path.at(-1) === node?.id ? graph.isLockedAt(path.slice(0, -1)) : true;
	});

	/** The group node whose group is set up here: the node, or the group its boundary is in. */
	const groupId = $derived.by(() => {
		if (node?.type === "node-group") return node.id;
		const boundary = node?.type === "group-input" || node?.type === "group-output";
		return inView && boundary ? graph.path.at(-1) : undefined;
	});
	const zoneId = $derived(
		inView && node && isZoneNodeType(node.type)
			? graph.activeZones.zoneOfBoundary.get(node.id)
			: undefined,
	);

	const defaultLabel = $derived(node ? graph.defaultNodeLabel(node.id) : "");
	let labelBuffer = $derived(node?.data.label ?? "");

	function commitLabel() {
		if (node) graph.setNodeLabel(node.id, labelBuffer);
		labelBuffer = node?.data.label ?? "";
	}
</script>

<Dialog.Root
	open={node !== undefined}
	onOpenChange={(open: boolean) => {
		if (open) return;
		// Closing can skip the field's blur.
		commitLabel();
		graph.sheetNodeId = null;
	}}
>
	<Dialog.Content
		side="right"
		class="w-[350px] overflow-y-auto sm:w-[400px]"
		onOpenAutoFocus={(e: Event) => e.preventDefault()}
		escapeKeydownBehavior="ignore"
	>
		{#if node}
			<Dialog.Header class="gap-0.5 p-4">
				<Dialog.Title>{node.data.label ?? defaultLabel}</Dialog.Title>
				{#if node.data.label !== undefined}
					<Dialog.Description>{defaultLabel}</Dialog.Description>
				{/if}
			</Dialog.Header>
			<div class="flex flex-col gap-4 p-4">
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">Label</span>
					<div class="flex items-center gap-1">
						<Input
							bind:value={labelBuffer}
							placeholder={defaultLabel}
							disabled={locked}
							onblur={commitLabel}
							onkeydown={(e: KeyboardEvent) => {
								if (e.key === "Enter") {
									e.preventDefault();
									(e.currentTarget as HTMLInputElement).blur();
								}
							}}
						/>
						<Button
							variant="ghost"
							size="icon-sm"
							title="Reset to {defaultLabel}"
							disabled={locked || node.data.label === undefined}
							onclick={() => graph.setNodeLabel(node.id, undefined)}
						>
							<ArrowCounterClockwiseIcon />
						</Button>
					</div>
				</div>
				{#if groupId}
					<GroupSettings {groupId} />
				{/if}
				{#if zoneId}
					<ZoneSettings {zoneId} />
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
