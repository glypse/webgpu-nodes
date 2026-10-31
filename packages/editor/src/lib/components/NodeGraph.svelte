<script lang="ts">
	import { Button } from "$theme";
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import ArrowElbowLeftUpIcon from "phosphor-svelte/lib/ArrowElbowLeftUpIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
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
			<nav aria-label="breadcrumb" class="min-w-0 overflow-x-auto text-xs">
				<ol
					class="text-muted-foreground flex flex-nowrap items-center gap-1 wrap-break-word sm:gap-1.5"
				>
					<li class="inline-flex items-center">
						{#if view.path.length === 0}
							<span aria-current="page">Root</span>
						{:else}
							<button
								type="button"
								class="hover:text-foreground cursor-pointer transition-colors"
								onclick={() => view.jumpToPath([])}
							>
								Root
							</button>
						{/if}
					</li>
					{#each view.pathLabels as segment, i (segment.id)}
						<li role="presentation" aria-hidden="true">
							<CaretRightIcon class="size-4" />
						</li>
						<li class="flex shrink-0 items-center gap-1 whitespace-nowrap">
							{#if i === view.pathLabels.length - 1}
								<span aria-current="page">{segment.label}</span>
							{:else}
								<button
									type="button"
									class="hover:text-foreground cursor-pointer transition-colors"
									onclick={() => view.jumpToPath(view.path.slice(0, i + 1))}
								>
									{segment.label}
								</button>
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
						</li>
					{/each}
				</ol>
			</nav>
		</AreaHeader>

		<GraphContent
			bind:nodes={view.nodes}
			bind:edges={view.edges}
			class={className}
			wrapperClass="min-h-0 flex-1"
		/>
	</div>
</SvelteFlowProvider>
