<script lang="ts">
	import { useSvelteFlow, ViewportPortal } from "@xyflow/svelte";

	import { firstCrossing } from "../geometry/stroke";
	import type { Point } from "../geometry/zone-geometry";
	import { getGraphManager } from "../graph-manager.svelte";
	import { getGraphView } from "../graph-view.svelte";

	/**
	 * Right-dragging over the graph draws a line: with Alt, every link it
	 * crosses is routed through a reroute where they cross (links from the
	 * same output sharing one); with Ctrl/Cmd, every link it crosses is
	 * deleted. Both happen on release.
	 */

	const graph = getGraphManager();
	const view = getGraphView();
	const { screenToFlowPosition } = useSvelteFlow();

	/** Reroutes are drawn this size, centred on where they're placed. */
	const REROUTE_SIZE = 18;
	/** Distance between the points links are sampled at, in flow units. */
	const SAMPLE_STEP = 8;

	let anchor = $state<SVGSVGElement | null>(null);
	/** The pointer drawing, once known: the context menu can come before its press. */
	let stroke = $state<{
		mode: "reroute" | "cut";
		points: Point[];
		pointerId: number | null;
	} | null>(null);
	/** The gesture's right-click must not open the context menu. */
	let suppressContextMenu = false;

	const polyline = $derived(stroke?.points.map((p) => `${String(p.x)},${String(p.y)}`).join(" "));

	/**
	 * Start drawing on a right press or its context menu, whichever comes
	 * first: the order differs between browsers.
	 */
	function start(event: MouseEvent, pointerId: number | null): boolean {
		if (view.locked) return false;
		const mode = event.altKey ? "reroute" : event.ctrlKey || event.metaKey ? "cut" : null;
		const flow = anchor?.closest(".svelte-flow");
		if (!mode || !(event.target instanceof Node) || !flow?.contains(event.target)) return false;
		view.activate();
		suppressContextMenu = true;
		stroke = {
			mode,
			points: [screenToFlowPosition({ x: event.clientX, y: event.clientY })],
			pointerId,
		};
		return true;
	}

	/** Whether a pointer event belongs to the stroke (adopting the first pointer seen). */
	function ofStroke(event: PointerEvent): boolean {
		if (!stroke) return false;
		stroke.pointerId ??= event.pointerId;
		return stroke.pointerId === event.pointerId;
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 2) return;
		if (stroke ? ofStroke(event) : start(event, event.pointerId)) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (!stroke || !ofStroke(event)) return;
		const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		stroke = { ...stroke, points: [...stroke.points, point] };
	}

	function handlePointerUp(event: PointerEvent) {
		if (!stroke || !ofStroke(event)) return;
		const { mode, points } = stroke;
		stroke = null;
		setTimeout(() => (suppressContextMenu = false));
		const crossings = crossedLinks(points);
		if (crossings.length === 0) return;
		if (mode === "cut") {
			graph.deleteNodes(
				[],
				crossings.map((c) => c.edgeId),
			);
		} else {
			graph.rerouteEdges(
				crossings.map(({ edgeId, position }) => ({
					edgeId,
					position: {
						x: position.x - REROUTE_SIZE / 2,
						y: position.y - REROUTE_SIZE / 2,
					},
				})),
			);
		}
	}

	/** The links drawn in this flow that the line crosses, and where. */
	function crossedLinks(points: Point[]): { edgeId: string; position: Point }[] {
		const flow = anchor?.closest(".svelte-flow");
		if (!flow || points.length < 2) return [];
		return [...flow.querySelectorAll<SVGGElement>(".svelte-flow__edge[data-id]")].flatMap(
			(edge) => {
				const path = edge.querySelector<SVGPathElement>("path[data-link-path]");
				const edgeId = edge.dataset.id;
				if (!path || !edgeId) return [];
				const position = firstCrossing(points, samplePath(path));
				return position ? [{ edgeId, position }] : [];
			},
		);
	}

	function samplePath(path: SVGPathElement): Point[] {
		const length = path.getTotalLength();
		const count = Math.max(2, Math.ceil(length / SAMPLE_STEP));
		return Array.from({ length: count + 1 }, (_, i) => {
			const { x, y } = path.getPointAtLength((length * i) / count);
			return { x, y };
		});
	}

	// Browsers send the context menu before the press, after it, or after
	// the release.
	function handleContextMenu(event: MouseEvent) {
		if (!suppressContextMenu && !start(event, null)) return;
		event.preventDefault();
		event.stopPropagation();
	}
</script>

<svelte:window
	onpointerdowncapture={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={() => (stroke = null)}
	oncontextmenucapture={handleContextMenu}
/>

<ViewportPortal target="front">
	<svg
		bind:this={anchor}
		class="pointer-events-none absolute overflow-visible"
		width="1"
		height="1"
	>
		{#if stroke && polyline}
			<polyline
				points={polyline}
				fill="none"
				stroke={stroke.mode === "cut" ? "var(--color-destructive)" : "var(--color-primary)"}
				stroke-width="2"
				stroke-dasharray={stroke.mode === "cut" ? "6 4" : undefined}
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			/>
		{/if}
	</svg>
</ViewportPortal>
