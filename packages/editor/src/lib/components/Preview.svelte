<script lang="ts">
	import { getPreview } from "../preview.svelte";

	const preview = getPreview();

	let canvas = $state<HTMLCanvasElement>();
	let container = $state<HTMLDivElement>();

	$effect(() => {
		if (!canvas) return;
		return preview.attach(canvas);
	});

	// The canvas renders at the pane's size in device pixels.
	$effect(() => {
		if (!container) return;
		const observer = new ResizeObserver(([entry]) => {
			const box = entry?.devicePixelContentBoxSize[0];
			if (!box) return;
			preview.configure({ width: box.inlineSize, height: box.blockSize }, "srgb");
		});
		observer.observe(container, { box: "device-pixel-content-box" });
		return () => {
			observer.disconnect();
		};
	});
</script>

<div bind:this={container} class="notexture relative size-full">
	<canvas bind:this={canvas} class="block size-full"></canvas>
	{#if preview.error}
		{@const error = preview.error}
		<div
			class="bg-background/70 border-border absolute right-2 bottom-2 left-2 z-10 rounded-lg border p-3 shadow-lg backdrop-blur"
		>
			<p class="mb-1 text-sm font-semibold text-red-500">{error.title}</p>
			<p class="text-xs">{error.message}</p>
			{#if error.snippet}
				<pre
					class="bg-muted/70 mt-2 max-h-32 overflow-auto rounded p-2 text-[11px] leading-tight">{error.snippet
						.map(
							(l) =>
								`${String(l.number).padStart(4)} ${l.highlight ? ">" : " "} ${l.code}`,
						)
						.join("\n")}</pre>
			{/if}
		</div>
	{/if}
</div>

<style>
	.notexture {
		background: repeating-conic-gradient(fuchsia 0 25%, black 0 50%) 50% / 40px 40px;
	}
</style>
