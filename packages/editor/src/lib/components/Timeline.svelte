<script lang="ts">
	import { Button, Scrubbable } from "$theme";
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import PauseIcon from "phosphor-svelte/lib/PauseIcon";
	import PlayIcon from "phosphor-svelte/lib/PlayIcon";
	import SkipBackIcon from "phosphor-svelte/lib/SkipBackIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import { getPreview } from "../preview.svelte";
	import AreaHeader from "./AreaHeader.svelte";

	let { areaId }: { areaId: string } = $props();

	const SLOW_RATIO = 0.95;

	const graph = getGraphManager();
	const preview = getPreview();

	const timing = $derived(graph.settings.timing);
	const rate = $derived(preview.frameRate);
	const refreshRate = $derived(
		preview.refreshRate === undefined ? undefined : Math.round(preview.refreshRate),
	);
	/** The rate playback should draw at: the display's in real time, the project's otherwise. */
	const target = $derived(timing.realtime ? (refreshRate ?? timing.fps) : timing.fps);
	/** Whether playback falls behind its target, past what timing jitter explains. */
	const slow = $derived(rate !== undefined && rate.fps < target * SLOW_RATIO);
	/** Whether the GPU alone takes longer than a frame lasts at the target rate. */
	const gpuSlow = $derived(rate?.gpuTime !== undefined && rate.gpuTime > 1 / target);
	const hint = $derived.by(() => {
		const lines: string[] = [];
		if (rate) lines.push(`Longest frame: ${formatMs(rate.worstFrameTime)} ms`);
		if (refreshRate !== undefined) {
			if (timing.realtime) lines.push(`Drawing at the display's ${String(refreshRate)} Hz`);
			else if (timing.fps > refreshRate)
				lines.push(`The display refreshes at only ${String(refreshRate)} Hz`);
		}
		lines.push("Time settings");
		return lines.join("\n");
	});

	function formatMs(seconds: number): string {
		return (seconds * 1000).toFixed(1);
	}

	function formatTime(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const rest = (seconds - minutes * 60).toFixed(2).padStart(5, "0");
		return `${String(minutes)}:${rest}`;
	}
</script>

<div class="bg-background flex size-full flex-col">
	<AreaHeader {areaId}>
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
			title={hint}
			onclick={() => {
				graph.settingsPage = "time";
			}}
		>
			{#if rate}
				<span class={{ "text-destructive": slow }}>{Math.round(rate.fps)}</span>/{target}
				fps ·
				<span class={{ "text-destructive": slow }}>{formatMs(rate.frameTime)} ms</span>
				{#if rate.gpuTime !== undefined}
					·
					<span class={{ "text-destructive": gpuSlow }}
						>GPU {formatMs(rate.gpuTime)} ms</span
					>
				{/if}
			{:else}
				{timing.fps} fps
			{/if}{timing.realtime ? " · real time" : ""}
		</Button>
	</AreaHeader>
</div>
