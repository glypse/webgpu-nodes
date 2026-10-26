<script lang="ts">
	import { Button, Scrubbable } from "$theme";
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import PauseIcon from "phosphor-svelte/lib/PauseIcon";
	import PlayIcon from "phosphor-svelte/lib/PlayIcon";
	import SkipBackIcon from "phosphor-svelte/lib/SkipBackIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import { getPreview } from "../preview.svelte";

	const graph = getGraphManager();
	const preview = getPreview();

	const timing = $derived(graph.settings.timing);

	function formatTime(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const rest = (seconds - minutes * 60).toFixed(2).padStart(5, "0");
		return `${String(minutes)}:${rest}`;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		// A focused control keeps its own keys (Space presses a button).
		if (target?.closest("input, textarea, select, button, [contenteditable], [role=menuitem]"))
			return;
		const actions: Record<string, () => void> = {
			" ": () => {
				preview.toggle();
			},
			",": () => {
				preview.step(-1);
			},
			".": () => {
				preview.step(1);
			},
			Home: () => {
				preview.seek(0);
			},
		};
		const action = actions[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="bg-background flex size-full flex-col">
	<div class="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs">
		<Button
			variant="ghost"
			size="icon-sm"
			title="Back to the start (Home)"
			onclick={() => {
				preview.seek(0);
			}}
		>
			<SkipBackIcon weight="fill" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Previous frame (,)"
			onclick={() => {
				preview.step(-1);
			}}
		>
			<CaretLeftIcon weight="bold" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title={preview.playing ? "Pause (Space)" : "Play (Space)"}
			onclick={() => {
				preview.toggle();
			}}
		>
			{#if preview.playing}
				<PauseIcon weight="fill" />
			{:else}
				<PlayIcon weight="fill" />
			{/if}
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Next frame (.)"
			onclick={() => {
				preview.step(1);
			}}
		>
			<CaretRightIcon weight="bold" />
		</Button>

		<div class="ml-2 flex w-36 shrink-0 items-center">
			<Scrubbable
				label="Frame"
				integer
				min={0}
				value={preview.frame}
				oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
					const frame = parseInt(e.currentTarget.value, 10);
					if (Number.isFinite(frame)) preview.seek(frame / timing.fps);
				}}
			/>
		</div>
		<span class="text-muted-foreground px-2 tabular-nums">{formatTime(preview.time)}</span>

		<div class="flex-1"></div>

		<Button
			variant="ghost"
			size="xs"
			class="text-muted-foreground tabular-nums"
			title="Time settings"
			onclick={() => {
				graph.settingsPage = "time";
			}}
		>
			{timing.fps} fps{timing.realtime ? " · real time" : ""}
		</Button>
	</div>
</div>
