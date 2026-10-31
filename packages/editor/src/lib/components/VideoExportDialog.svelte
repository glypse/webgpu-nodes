<script lang="ts">
	import { MAX_FPS } from "$core";
	import { Button, Dialog, Progress, Scrubbable, ToggleGroup } from "$theme";

	import {
		VIDEO_FORMATS,
		VIDEO_QUALITIES,
		type VideoExport,
		type VideoFormat,
		type VideoQuality,
		encodeVideo,
		frameCount,
		videoSize,
	} from "../exports";
	import { getGraphManager } from "../graph-manager.svelte";
	import { getPreview } from "../preview.svelte";
	import { downloadFile } from "../utils";
	import SettingField from "./settings/SettingField.svelte";

	const graph = getGraphManager();
	const preview = getPreview();

	let options = $state<VideoExport>({
		format: "mp4",
		quality: "high",
		start: 0,
		duration: 5,
		fps: 60,
	});
	let progress = $state<{ done: number; total: number } | null>(null);
	let error = $state<string | null>(null);
	let abort: AbortController | undefined;

	// Each opening starts from the project's frame rate.
	$effect(() => {
		if (preview.exportDialogOpen) {
			options.fps = graph.settings.timing.fps;
			error = null;
		}
	});

	const size = $derived(preview.output.size);
	const encoded = $derived(videoSize(size));
	const frames = $derived(frameCount(options));

	function numberInput(apply: (value: number) => void) {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			const value = parseFloat(e.currentTarget.value);
			if (Number.isFinite(value)) apply(value);
		};
	}

	async function start() {
		abort = new AbortController();
		error = null;
		progress = { done: 0, total: frames };
		const wasPlaying = preview.playing;
		preview.pause();
		try {
			const blob = await encodeVideo(preview, $state.snapshot(options), {
				signal: abort.signal,
				onProgress: (done, total) => {
					progress = { done, total };
				},
			});
			downloadFile(`webgpu-nodes.${VIDEO_FORMATS[options.format].extension}`, blob);
			preview.exportDialogOpen = false;
		} catch (e) {
			if (!abort.signal.aborted) error = e instanceof Error ? e.message : String(e);
		} finally {
			progress = null;
			abort = undefined;
			if (wasPlaying) preview.play();
		}
	}
</script>

<Dialog.Root
	open={preview.exportDialogOpen}
	onOpenChange={(open: boolean) => {
		if (!open) abort?.abort();
		preview.exportDialogOpen = open;
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Export video</Dialog.Title>
			<Dialog.Description>
				{encoded.width} × {encoded.height}, {frames}
				{frames === 1 ? "frame" : "frames"}, in sRGB{graph.settings.colorSpace ===
				"display-p3"
					? " (colours past it are clipped)"
					: ""}.
				{#if encoded.width !== size.width || encoded.height !== size.height}
					Encoders need even sizes, so the canvas ({size.width} × {size.height}) loses its
					last row or column.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<fieldset disabled={progress !== null} class="flex flex-col gap-5">
			<SettingField label="Format">
				<ToggleGroup.Root
					type="single"
					value={options.format}
					onValueChange={(value: string) => {
						if (value in VIDEO_FORMATS) options.format = value as VideoFormat;
					}}
				>
					{#each Object.entries(VIDEO_FORMATS) as [id, format] (id)}
						<ToggleGroup.Item value={id}>{format.label}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			</SettingField>

			<SettingField label="Quality">
				<ToggleGroup.Root
					type="single"
					value={options.quality}
					onValueChange={(value: string) => {
						if (value in VIDEO_QUALITIES) options.quality = value as VideoQuality;
					}}
				>
					{#each Object.entries(VIDEO_QUALITIES) as [id, quality] (id)}
						<ToggleGroup.Item value={id}>{quality.label}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			</SettingField>

			<SettingField
				label="Range"
				description="In seconds, rendered on the frame rate's grid."
			>
				<div class="grid grid-cols-2 gap-2">
					<div class="flex items-center">
						<Scrubbable
							label="Start"
							min={0}
							value={options.start}
							oninput={numberInput((v) => (options.start = Math.max(0, v)))}
						/>
					</div>
					<div class="flex items-center">
						<Scrubbable
							label="Duration"
							min={0}
							value={options.duration}
							oninput={numberInput((v) => (options.duration = Math.max(0, v)))}
						/>
					</div>
				</div>
			</SettingField>

			<SettingField label="Frame rate">
				<div class="flex w-40 items-center">
					<Scrubbable
						label="FPS"
						min={1}
						max={MAX_FPS}
						value={options.fps}
						oninput={numberInput(
							(v) => (options.fps = Math.min(MAX_FPS, Math.max(1, v))),
						)}
					/>
				</div>
			</SettingField>
		</fieldset>

		{#if progress}
			<div class="flex flex-col gap-1.5">
				<Progress value={progress.done} max={progress.total} />
				<span class="text-muted-foreground text-xs tabular-nums">
					Frame {progress.done} of {progress.total}
				</span>
			</div>
		{/if}
		{#if error}
			<p class="text-destructive text-xs">{error}</p>
		{/if}

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="ghost">Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button disabled={progress !== null} onclick={start}>Export</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
