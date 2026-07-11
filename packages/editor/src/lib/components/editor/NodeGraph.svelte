<script lang="ts">
	import * as Breadcrumb from "$theme/components/ui/breadcrumb";
	import { SvelteFlowProvider } from "@xyflow/svelte";

	import { getGraphManager } from "./graph-state.svelte";
	import GraphContent from "./GraphContent.svelte";

	const graph = getGraphManager();

	let { class: className, frag = $bindable() }: { class?: string; frag?: string } = $props();
</script>

<SvelteFlowProvider>
	{#if graph.path.length > 0}
		<div class="flex items-center gap-2 border-b px-3 py-2">
			<button
				class="text-muted-foreground hover:text-foreground text-xs"
				onclick={() => graph.exitGroup()}
			>
				← Back
			</button>
			<Breadcrumb.Root>
				<Breadcrumb.List>
					<Breadcrumb.Item>
						<Breadcrumb.Link
							href="#"
							onclick={(e: MouseEvent) => {
								e.preventDefault();
								graph.jumpToPath([]);
							}}
						>
							Root
						</Breadcrumb.Link>
					</Breadcrumb.Item>
					{#each graph.pathLabels as segment, i (segment.id)}
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							{#if i === graph.pathLabels.length - 1}
								<Breadcrumb.Page>{segment.label}</Breadcrumb.Page>
							{:else}
								<Breadcrumb.Link
									href="#"
									onclick={(e: MouseEvent) => {
										e.preventDefault();
										graph.jumpToPath(graph.path.slice(0, i + 1));
									}}
								>
									{segment.label}
								</Breadcrumb.Link>
							{/if}
						</Breadcrumb.Item>
					{/each}
				</Breadcrumb.List>
			</Breadcrumb.Root>
		</div>
	{/if}
	<GraphContent bind:nodes={graph.nodes} bind:edges={graph.edges} bind:frag class={className} />
</SvelteFlowProvider>
