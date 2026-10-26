<script lang="ts">
	import { ControlButton, Panel } from "@xyflow/svelte";
	import { mode } from "mode-watcher";
	import { on } from "svelte/events";

	import { getGraphManager } from "../graph-manager.svelte";
	import { type Point, PreviewView } from "../preview-view.svelte";
	import { getPreview } from "../preview.svelte";
	import AreaHeader from "./AreaHeader.svelte";
	import PreviewToolbar from "./PreviewToolbar.svelte";

	let { areaId }: { areaId: string } = $props();

	const graph = getGraphManager();
	const preview = getPreview();
	const view = new PreviewView();

	$effect(() => preview.addArea(areaId, view));

	let canvas = $state<HTMLCanvasElement>();
	let pane = $state<HTMLDivElement>();
	let hovered = $state(false);
	let panning = $state<{ pointerId: number; last: Point } | null>(null);

	$effect(() => {
		if (!canvas) return;
		return preview.attach(canvas);
	});

	$effect(() => {
		if (!pane) return;
		const observer = new ResizeObserver(([entry]) => {
			const css = entry?.contentBoxSize[0];
			const device = entry?.devicePixelContentBoxSize[0];
			if (!css || !device) return;
			view.pane = { width: css.inlineSize, height: css.blockSize };
			view.dpr = css.inlineSize > 0 ? device.inlineSize / css.inlineSize : 1;
			preview.setPaneSize(areaId, { width: device.inlineSize, height: device.blockSize });
		});
		observer.observe(pane, { box: "device-pixel-content-box" });
		return () => {
			observer.disconnect();
		};
	});

	const followPreview = $derived(graph.settings.canvas.followPreview);

	// Following the preview, the canvas fills it: start from there.
	$effect(() => {
		if (followPreview) view.fit();
	});

	function pointIn(event: MouseEvent): Point {
		const box = pane?.getBoundingClientRect();
		return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
	}

	// Gestures follow the graph's (d3-zoom's): the wheel zooms by 2^delta
	// around the pointer (ten times faster when pinching on macOS), dragging
	// pans and a double click zooms in (out with Shift) by 2.
	$effect(() => {
		if (!pane) return;
		const isMac = navigator.userAgent.includes("Mac");
		return on(
			pane,
			"wheel",
			(event: WheelEvent) => {
				event.preventDefault();
				const speed = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
				const delta = -event.deltaY * speed * (event.ctrlKey && isMac ? 10 : 1);
				view.zoomBy(2 ** delta, pointIn(event));
			},
			{ passive: false },
		);
	});

	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 0 && event.button !== 1) return;
		if ((event.target as HTMLElement).closest(".svelte-flow__panel")) return;
		pane?.setPointerCapture(event.pointerId);
		panning = { pointerId: event.pointerId, last: { x: event.clientX, y: event.clientY } };
	}

	function handlePointerMove(event: PointerEvent) {
		if (panning?.pointerId !== event.pointerId) return;
		view.panBy(event.clientX - panning.last.x, event.clientY - panning.last.y);
		panning = { pointerId: event.pointerId, last: { x: event.clientX, y: event.clientY } };
	}

	function handlePointerUp(event: PointerEvent) {
		if (panning?.pointerId === event.pointerId) panning = null;
	}

	function handleDoubleClick(event: MouseEvent) {
		if ((event.target as HTMLElement).closest(".svelte-flow__panel")) return;
		view.zoomBy(event.shiftKey ? 0.5 : 2, pointIn(event));
	}

	// Shortcuts apply while the pointer is over the preview.
	function handleKeydown(event: KeyboardEvent) {
		if (!hovered || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest("input, textarea, [contenteditable]")) return;
		const actions: Record<string, () => void> = {
			"+": () => {
				view.zoomIn();
			},
			"=": () => {
				view.zoomIn();
			},
			"-": () => {
				view.zoomOut();
			},
			"0": () => {
				view.fit();
			},
			"1": () => {
				view.actualSize();
			},
		};
		const action = actions[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex size-full flex-col">
	<AreaHeader {areaId}>
		<PreviewToolbar {view} />
	</AreaHeader>
	<!-- Svelte Flow's classes, so the controls look like the graph's. -->
	<div
		bind:this={pane}
		class={[
			"svelte-flow bg-background relative min-h-0 flex-1 touch-none overflow-hidden",
			mode.current,
			panning ? "cursor-grabbing" : "cursor-grab",
		]}
		role="application"
		aria-label="Preview"
		onpointerenter={() => (hovered = true)}
		onpointerleave={() => (hovered = false)}
		onpointerdowncapture={() => {
			preview.activeArea = areaId;
		}}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		ondblclick={handleDoubleClick}
	>
		<canvas
			bind:this={canvas}
			class={[
				"notexture absolute block",
				!followPreview && "ring-border shadow-lg ring-1",
				// Past one canvas pixel per device pixel, show pixels as squares.
				view.zoom > 1 && "pixelated",
			]}
			style:left="{view.rect.x}px"
			style:top="{view.rect.y}px"
			style:width="{view.rect.width}px"
			style:height="{view.rect.height}px"
		></canvas>

		<Panel position="bottom-left" class="svelte-flow__controls vertical">
			<ControlButton
				class="svelte-flow__controls-fitview"
				title="Fit view (0)"
				aria-label="Fit view"
				onclick={() => {
					view.fit();
				}}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30">
					<path
						d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z"
					/>
				</svg>
			</ControlButton>
		</Panel>

		{#if preview.error}
			{@const error = preview.error}
			<div
				class="bg-background/70 border-border absolute right-2 bottom-2 left-14 z-10 cursor-auto rounded-lg border p-3 shadow-lg backdrop-blur"
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
</div>

<style>
	.notexture {
		background: repeating-conic-gradient(fuchsia 0 25%, black 0 50%) 50% / 40px 40px;
	}

	.pixelated {
		image-rendering: pixelated;
	}
</style>
