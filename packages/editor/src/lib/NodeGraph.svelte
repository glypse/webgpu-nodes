<script lang="ts">
	import { Breadcrumb, Button } from "$theme";
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import ArrowElbowLeftUpIcon from "phosphor-svelte/lib/ArrowElbowLeftUpIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";

	import { getGraphManager } from "./graph-state.svelte";
	import GraphContent from "./GraphContent.svelte";

	const graph = getGraphManager();

	let { class: className, frag = $bindable() }: { class?: string; frag?: string } = $props();
</script>

<SvelteFlowProvider>
	<div class="relative flex h-full min-h-0 flex-col">
		{#if graph.path.length > 0}
			<div
				class="bg-background/20 border-border/80 absolute top-4 left-1/2 z-10 flex max-w-[75%] -translate-x-1/2 items-center gap-6 overflow-x-auto rounded-full border px-3 py-1.5 shadow-lg backdrop-blur"
			>
				<Button
					onclick={() => graph.exitGroup()}
					variant="secondary"
					size="icon-sm"
					href="#"
					class="shrink-0"
				>
					<ArrowElbowLeftUpIcon />
				</Button>
				<Breadcrumb.Root class="shrink-0">
					<Breadcrumb.List class="flex-nowrap">
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
							<Breadcrumb.Item class="flex shrink-0 items-center gap-2 whitespace-nowrap">
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
								{#if segment.locked}
									<Button
										type="button"
										size="icon-sm"
										variant="secondary"
										title="Locked group - clone & edit"
										onclick={() => graph.deepClone(segment.id)}
									>
										<LockSimpleIcon class="size-4" />
									</Button>
								{/if}
							</Breadcrumb.Item>
						{/each}
					</Breadcrumb.List>
				</Breadcrumb.Root>
			</div>
		{/if}

		<GraphContent
			bind:nodes={graph.nodes}
			bind:edges={graph.edges}
			bind:frag
			class={className}
			wrapperClass="min-h-0 flex-1"
		/>
	</div>
</SvelteFlowProvider>
