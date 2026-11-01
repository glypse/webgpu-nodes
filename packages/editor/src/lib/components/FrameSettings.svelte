<script lang="ts">
	import { FRAME_TINTS, type FrameTint } from "$core";
	import { Textarea } from "$theme";
	import ProhibitIcon from "phosphor-svelte/lib/ProhibitIcon";

	import { getGraphManager } from "../graph-manager.svelte";

	let { frameId, locked }: { frameId: string; locked: boolean } = $props();

	const graph = getGraphManager();

	const data = $derived(graph.resolveNode(frameId)?.data ?? {});
	let noteBuffer = $derived(data.note ?? "");

	function commitNote() {
		const note = noteBuffer.trim() === "" ? undefined : noteBuffer.trimEnd();
		if (note !== data.note) graph.updateNodeData(frameId, { note }, { retype: false });
	}

	function pickTint(tint: FrameTint | undefined) {
		graph.updateNodeData(frameId, { tint }, { retype: false });
	}
</script>

<div class="flex flex-col gap-1.5">
	<span class="text-sm font-medium">Note</span>
	<Textarea
		bind:value={noteBuffer}
		placeholder="What this part of the graph does…"
		disabled={locked}
		onblur={commitNote}
	/>
</div>
<div class="flex flex-col gap-1.5">
	<span class="text-sm font-medium">Colour</span>
	<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
		<button
			type="button"
			role="radio"
			aria-checked={data.tint === undefined}
			aria-label="None"
			title="None"
			disabled={locked}
			class="frame-tint frame-swatch"
			onclick={() => pickTint(undefined)}
		>
			<ProhibitIcon class="size-4" />
		</button>
		{#each FRAME_TINTS as tint (tint)}
			<button
				type="button"
				role="radio"
				aria-checked={data.tint === tint}
				aria-label={tint}
				title={tint.charAt(0).toUpperCase() + tint.slice(1)}
				disabled={locked}
				class="frame-tint frame-swatch"
				data-tint={tint}
				onclick={() => pickTint(tint)}
			></button>
		{/each}
	</div>
</div>

<style>
	.frame-swatch {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: color-mix(in oklab, var(--frame-color) 60%, transparent);
		color: var(--muted-foreground);
		cursor: pointer;
	}

	.frame-swatch[aria-checked="true"] {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	.frame-swatch:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
