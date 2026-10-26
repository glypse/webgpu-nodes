<script lang="ts">
	import { getGraphManager } from "../graph-manager.svelte";
	import { getPreview } from "../preview.svelte";

	const graph = getGraphManager();
	const preview = getPreview();

	let canvas = $state<HTMLCanvasElement>();
	let container = $state<HTMLDivElement>();
	/** The pane's size in CSS pixels and in device pixels. */
	let pane = $state({ width: 0, height: 0, deviceWidth: 0, deviceHeight: 0 });

	$effect(() => {
		if (!canvas) return;
		return preview.attach(canvas);
	});

	$effect(() => {
		if (!container) return;
		const observer = new ResizeObserver(([entry]) => {
			const css = entry?.contentBoxSize[0];
			const device = entry?.devicePixelContentBoxSize[0];
			if (!css || !device) return;
			pane = {
				width: css.inlineSize,
				height: css.blockSize,
				deviceWidth: device.inlineSize,
				deviceHeight: device.blockSize,
			};
		});
		observer.observe(container, { box: "device-pixel-content-box" });
		return () => {
			observer.disconnect();
		};
	});

	const resolution = $derived(
		graph.settings.canvas.followPreview
			? { width: pane.deviceWidth, height: pane.deviceHeight }
			: { width: graph.settings.canvas.width, height: graph.settings.canvas.height },
	);

	$effect(() => {
		preview.configure(resolution, graph.settings.colorSpace);
	});

	const fps = $derived(graph.settings.timing.fps);
	const realtime = $derived(graph.settings.timing.realtime);
	$effect(() => {
		preview.setTiming({ fps, realtime });
	});

	/** The canvas fitted into the pane, in CSS pixels. */
	const fitted = $derived.by(() => {
		if (resolution.width === 0 || resolution.height === 0) return { width: 0, height: 0 };
		const scale = Math.min(pane.width / resolution.width, pane.height / resolution.height);
		return { width: resolution.width * scale, height: resolution.height * scale };
	});
</script>

<div bind:this={container} class="bg-muted/30 relative flex size-full items-center justify-center">
	<canvas
		bind:this={canvas}
		class="notexture block shrink-0"
		style:width="{fitted.width}px"
		style:height="{fitted.height}px"
	></canvas>
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
