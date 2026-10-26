<script lang="ts">
	import { Breadcrumb, Button } from "$theme";
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import ArrowElbowLeftUpIcon from "phosphor-svelte/lib/ArrowElbowLeftUpIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";

	import { setDocumentView } from "../document-view";
	import { getGraphManager } from "../graph-manager.svelte";
	import { GraphView, setGraphView } from "../graph-view.svelte";
	import AreaHeader from "./AreaHeader.svelte";
	import GraphContent from "./GraphContent.svelte";

	const graph = getGraphManager();

	let { areaId, class: className }: { areaId: string; class?: string } = $props();

	// Areas are keyed by id, so this component's area never changes.
	// svelte-ignore state_referenced_locally
	const view = new GraphView(graph, areaId);
	setGraphView(view);
	setDocumentView(view);
</script>

<SvelteFlowProvider>
	<div class="relative flex size-full min-h-0 flex-col">
		<AreaHeader {areaId}>
			{#if view.path.length > 0}
				<Button
					onclick={() => view.exitGroup()}
					variant="ghost"
					size="icon-xs"
					class="shrink-0"
					title="Exit group (Esc)"
				>
					<ArrowElbowLeftUpIcon />
				</Button>
			{/if}
			<Breadcrumb.Root class="min-w-0 overflow-x-auto text-xs">
				<Breadcrumb.List class="flex-nowrap gap-1 text-xs sm:gap-1.5">
					<Breadcrumb.Item>
						{#if view.path.length === 0}
							<Breadcrumb.Page>Root</Breadcrumb.Page>
						{:else}
							<Breadcrumb.Link
								href="#"
								onclick={(e: MouseEvent) => {
									e.preventDefault();
									view.jumpToPath([]);
								}}
							>
								Root
							</Breadcrumb.Link>
						{/if}
					</Breadcrumb.Item>
					{#each view.pathLabels as segment, i (segment.id)}
						<Breadcrumb.Separator />
						<Breadcrumb.Item class="flex shrink-0 items-center gap-1 whitespace-nowrap">
							{#if i === view.pathLabels.length - 1}
								<Breadcrumb.Page>{segment.label}</Breadcrumb.Page>
							{:else}
								<Breadcrumb.Link
									href="#"
									onclick={(e: MouseEvent) => {
										e.preventDefault();
										view.jumpToPath(view.path.slice(0, i + 1));
									}}
								>
									{segment.label}
								</Breadcrumb.Link>
							{/if}
							{#if segment.locked}
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									title="Locked group - clone & edit"
									onclick={() => {
										view.activate();
										graph.deepClone(segment.id);
									}}
								>
									<LockSimpleIcon />
								</Button>
							{/if}
						</Breadcrumb.Item>
					{/each}
				</Breadcrumb.List>
			</Breadcrumb.Root>
		</AreaHeader>

		<GraphContent
			bind:nodes={view.nodes}
			bind:edges={view.edges}
			class={className}
			wrapperClass="min-h-0 flex-1"
		/>
	</div>
</SvelteFlowProvider>
