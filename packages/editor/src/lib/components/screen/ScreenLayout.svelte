<script lang="ts">
	import {
		type Area,
		type DockTarget,
		type EdgeSelection,
		type MinSize,
		type Rect,
		type Screen,
		areaAt,
		closeArea,
		defaultEditor,
		dockArea,
		edgeAt,
		findArea,
		joinAreas,
		moveEdge,
		neighbourSide,
		splitArea,
		swapAreas,
	} from "$core";

	import { getGraphManager } from "../../graph-manager.svelte";
	import { openContextMenuAt } from "../../utils";
	import NodeGraph from "../NodeGraph.svelte";
	import Preview from "../Preview.svelte";
	import Timeline from "../Timeline.svelte";
	import EdgeMenu from "./EdgeMenu.svelte";
	import { setScreenControls } from "./screen-controls";

	const graph = getGraphManager();

	/** Smallest area: a header and a bit of body. */
	const MIN_AREA_PX = { width: 96, height: 56 };
	/** How close to an edge the pointer grabs it. */
	const EDGE_GRAB_PX = 4;
	/** How far a corner drag goes before it splits, joins or docks. */
	const CORNER_DRAG_PX = 16;
	/** Within this distance of the shared edge, dragging into a neighbour joins rather than docks. */
	const JOIN_ZONE_PX = 5 * 36;

	let container = $state<HTMLDivElement>();
	let size = $state({ width: 1, height: 1, left: 0, top: 0 });
	let maximized = $state<string | null>(null);

	$effect(() => {
		if (!container) return;
		const element = container;
		const observer = new ResizeObserver(() => {
			const box = element.getBoundingClientRect();
			size = {
				width: Math.max(1, box.width),
				height: Math.max(1, box.height),
				left: box.left,
				top: box.top,
			};
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	});

	const min = $derived<MinSize>({
		width: MIN_AREA_PX.width / size.width,
		height: MIN_AREA_PX.height / size.height,
	});
	const grab = $derived<MinSize>({
		width: EDGE_GRAB_PX / size.width,
		height: EDGE_GRAB_PX / size.height,
	});

	const createId = () => crypto.randomUUID();

	/** A pointer position as window fractions. */
	function toScreen(event: MouseEvent): { x: number; y: number } {
		return {
			x: (event.clientX - size.left) / size.width,
			y: (event.clientY - size.top) / size.height,
		};
	}

	function apply(screen: Screen | undefined) {
		if (screen) graph.setScreen(screen);
	}

	// ── Edges ────────────────────────────────────────────────────────────────

	let hoverEdge = $state<"x" | "y" | null>(null);
	let edgeDrag = $state<{ edge: EdgeSelection; screen: Screen; pointerId: number } | null>(null);

	/** The edge position asked for since the last frame, applied once per frame. */
	let pendingEdge: number | null = null;

	function applyEdgeMove() {
		const drag = edgeDrag;
		const position = pendingEdge;
		pendingEdge = null;
		if (drag && position !== null)
			graph.setScreen(moveEdge(drag.screen, drag.edge, position, min));
	}

	function handlePointerMove(event: PointerEvent) {
		lastPoint = toScreen(event);
		if (splitting) {
			splitting = splitAt(splitting.axis, lastPoint);
			return;
		}
		if (edgeDrag) {
			if (event.pointerId !== edgeDrag.pointerId) return;
			const point = toScreen(event);
			if (pendingEdge === null) requestAnimationFrame(applyEdgeMove);
			pendingEdge = edgeDrag.edge.axis === "x" ? point.x : point.y;
			return;
		}
		if (cornerDrag || maximized) return;
		const point = toScreen(event);
		hoverEdge = edgeAt(graph.screen, point.x, point.y, grab)?.axis ?? null;
	}

	function handlePointerDown(event: PointerEvent) {
		if (splitting) {
			event.preventDefault();
			event.stopPropagation();
			cancelledByRightClick = event.button === 2;
			finishSplit(event.button === 0);
			return;
		}
		if (event.button !== 0 || maximized) return;
		const point = toScreen(event);
		const edge = edgeAt(graph.screen, point.x, point.y, grab, { extend: event.shiftKey });
		if (!edge) return;
		event.preventDefault();
		event.stopPropagation();
		container?.setPointerCapture(event.pointerId);
		edgeDrag = { edge, screen: graph.screen, pointerId: event.pointerId };
	}

	function handlePointerUp(event: PointerEvent) {
		if (edgeDrag?.pointerId !== event.pointerId) return;
		applyEdgeMove();
		edgeDrag = null;
	}

	// ── Edge menu: split, join, swap ─────────────────────────────────────────
	// Right-clicking an edge offers Blender's options for the two areas
	// meeting there under the pointer. Splitting then follows the pointer,
	// over any area, until a click splits there (a right-click or Escape
	// cancels).

	let edgeMenuTrigger = $state<HTMLElement | null>(null);
	let edgeMenu = $state<{ axis: "x" | "y"; before: string; after: string }>({
		axis: "x",
		before: "",
		after: "",
	});

	/** Where the pointer last was over the screen, as window fractions. */
	let lastPoint = { x: 0, y: 0 };

	let splitting = $state<{ axis: "x" | "y"; area: string | null; at: number } | null>(null);
	/** Set when a right-click cancels a split: its context menu mustn't open. */
	let cancelledByRightClick = false;

	function joined(forward: boolean): Screen | undefined {
		const [keep, remove] = forward
			? [edgeMenu.before, edgeMenu.after]
			: [edgeMenu.after, edgeMenu.before];
		return joinAreas(graph.screen, keep, remove, min, createId);
	}

	function handleContextMenuCapture(event: MouseEvent) {
		// The menu's own opening comes through here too.
		if (!event.isTrusted) return;
		// Some browsers send it before the press, which then hasn't cancelled yet.
		if (cancelledByRightClick || splitting) {
			cancelledByRightClick = false;
			finishSplit(false);
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (maximized) return;
		const point = toScreen(event);
		const edge = edgeAt(graph.screen, point.x, point.y, grab);
		if (!edge) return;
		const offset = 2 * (edge.axis === "x" ? grab.width : grab.height);
		const [before, after] = [-offset, offset].map((d) =>
			edge.axis === "x"
				? areaAt(graph.screen, edge.position + d, point.y)
				: areaAt(graph.screen, point.x, edge.position + d),
		);
		if (!before || !after || before.id === after.id) return;
		event.preventDefault();
		event.stopPropagation();
		edgeMenu = { axis: edge.axis, before: before.id, after: after.id };
		if (edgeMenuTrigger) openContextMenuAt(edgeMenuTrigger, event.clientX, event.clientY);
	}

	/** Where a split along `axis` would go, at a point. */
	function splitAt(axis: "x" | "y", point: { x: number; y: number }) {
		const area = areaAt(graph.screen, point.x, point.y);
		if (!area) return { axis, area: null, at: 0 };
		const { rect } = area;
		const w = rect.right - rect.left;
		const h = rect.bottom - rect.top;
		const at =
			axis === "x"
				? rect.left + snapHalf((point.x - rect.left) / w, min.width / w) * w
				: rect.top + snapHalf((point.y - rect.top) / h, min.height / h) * h;
		return { axis, area: area.id, at };
	}

	function finishSplit(confirm: boolean) {
		const split = splitting;
		splitting = null;
		if (!confirm || !split?.area) return;
		apply(splitArea(graph.screen, split.area, split.axis, split.at, createId(), "after", min));
	}

	// ── Corners: split, join, dock, swap ─────────────────────────────────────

	type Outcome =
		| { kind: "split"; axis: "x" | "y"; at: number; side: "before" | "after" }
		| { kind: "join"; target: string }
		| { kind: "dock"; target: string; where: DockTarget; factor: number }
		| { kind: "swap"; target: string };

	let cornerDrag = $state<{
		source: string;
		start: { x: number; y: number };
		swap: boolean;
		outcome: Outcome | null;
	} | null>(null);

	function startCornerDrag(areaId: string, event: PointerEvent) {
		if (event.button !== 0 || maximized) return;
		event.preventDefault();
		event.stopPropagation();
		cornerDrag = {
			source: areaId,
			start: { x: event.clientX, y: event.clientY },
			swap: event.ctrlKey,
			outcome: null,
		};
	}

	/** Blender's slight snap of halves, and its minimum part size. */
	function snapHalf(fraction: number, minFraction: number): number {
		const snapped = Math.abs(fraction - 0.5) < 0.02 ? 0.5 : fraction;
		return Math.min(1 - minFraction, Math.max(minFraction, snapped));
	}

	function cornerOutcome(source: Area, event: PointerEvent, swap: boolean): Outcome | null {
		const start = cornerDrag?.start;
		if (!start) return null;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (Math.max(Math.abs(dx), Math.abs(dy)) < CORNER_DRAG_PX) return null;
		const point = toScreen(event);
		const target = areaAt(graph.screen, point.x, point.y);
		if (!target) return null;
		if (swap) return target.id === source.id ? null : { kind: "swap", target: target.id };

		const { rect } = target;
		const w = rect.right - rect.left;
		const h = rect.bottom - rect.top;
		if (target.id === source.id) {
			// Split along the dominant direction, the new area on the side the drag came from.
			const axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
			const fraction =
				axis === "x"
					? snapHalf((point.x - rect.left) / w, min.width / w)
					: snapHalf((point.y - rect.top) / h, min.height / h);
			const at = axis === "x" ? rect.left + fraction * w : rect.top + fraction * h;
			const from =
				(axis === "x" ? start.x - size.left : start.y - size.top) /
				(axis === "x" ? size.width : size.height);
			return { kind: "split", axis, at, side: from < at ? "before" : "after" };
		}

		// Close to the edge it shares with the source, a neighbour is joined.
		const side = neighbourSide(source, target, min);
		if (side) {
			const distance =
				side === "right"
					? (point.x - rect.left) * size.width
					: side === "left"
						? (rect.right - point.x) * size.width
						: side === "bottom"
							? (point.y - rect.top) * size.height
							: (rect.bottom - point.y) * size.height;
			const zone = Math.min(
				JOIN_ZONE_PX,
				(side === "left" || side === "right" ? w * size.width : h * size.height) / 4,
			);
			if (distance < zone) return { kind: "join", target: target.id };
		}

		// Elsewhere, docked: in its middle, or towards the nearest side along its diagonals.
		const fx = (point.x - rect.left) / w;
		const fy = (point.y - rect.top) / h;
		if (fx > 0.4 && fx < 0.6 && fy > 0.4 && fy < 0.6) {
			return { kind: "dock", target: target.id, where: "center", factor: 0.5 };
		}
		const horizontal =
			Math.abs(fx - 0.5) * w * size.width > Math.abs(fy - 0.5) * h * size.height;
		const where: DockTarget = horizontal
			? fx < 0.5
				? "left"
				: "right"
			: fy < 0.5
				? "top"
				: "bottom";
		const position =
			where === "left" ? fx : where === "right" ? 1 - fx : where === "top" ? fy : 1 - fy;
		const minFraction = horizontal ? min.width / w : min.height / h;
		return {
			kind: "dock",
			target: target.id,
			where,
			factor: snapHalf(position * 2, minFraction),
		};
	}

	function finishCornerDrag() {
		const drag = cornerDrag;
		cornerDrag = null;
		if (!drag?.outcome) return;
		const screen = graph.screen;
		const outcome = drag.outcome;
		if (outcome.kind === "split") {
			apply(
				splitArea(
					screen,
					drag.source,
					outcome.axis,
					outcome.at,
					createId(),
					outcome.side,
					min,
				),
			);
		} else if (outcome.kind === "join") {
			apply(joinAreas(screen, drag.source, outcome.target, min, createId));
		} else if (outcome.kind === "dock") {
			apply(
				dockArea(
					screen,
					drag.source,
					outcome.target,
					outcome.where,
					outcome.factor,
					min,
					createId,
				),
			);
		} else {
			apply(swapAreas(screen, drag.source, outcome.target));
		}
	}

	function handleWindowPointerMove(event: PointerEvent) {
		if (!cornerDrag) return;
		const source = findArea(graph.screen, cornerDrag.source);
		cornerDrag.outcome = source ? cornerOutcome(source, event, cornerDrag.swap) : null;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && (cornerDrag || splitting)) {
			event.preventDefault();
			event.stopPropagation();
			cornerDrag = null;
			splitting = null;
		}
		if (event.key === " " && event.ctrlKey && !event.metaKey && !event.altKey) {
			const hovered = hoveredArea;
			if (hovered) {
				event.preventDefault();
				toggleMaximized(hovered);
			}
		}
	}

	// ── Area actions ─────────────────────────────────────────────────────────

	let hoveredArea = $state<string | null>(null);

	function toggleMaximized(areaId: string) {
		maximized = maximized === areaId ? null : areaId;
	}

	setScreenControls({
		startCornerDrag,
		split(areaId, axis) {
			const area = findArea(graph.screen, areaId);
			if (!area) return;
			const { rect } = area;
			const at = axis === "x" ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;
			apply(splitArea(graph.screen, areaId, axis, at, createId(), "after", min));
		},
		close(areaId) {
			if (maximized === areaId) maximized = null;
			apply(closeArea(graph.screen, areaId, min, createId));
		},
		toggleMaximized,
		setEditorType(areaId, type) {
			const area = findArea(graph.screen, areaId);
			if (!area || area.editor.type === type) return;
			graph.setAreaEditor(areaId, defaultEditor(type));
		},
		get maximized() {
			return maximized;
		},
		get areaCount() {
			return graph.screen.areas.length;
		},
	});

	// ── Rendering ────────────────────────────────────────────────────────────

	const FULL: Rect = { left: 0, top: 0, right: 1, bottom: 1 };

	function style(rect: Rect): string {
		return `left: ${String(rect.left * 100)}%; top: ${String(rect.top * 100)}%; width: ${String((rect.right - rect.left) * 100)}%; height: ${String((rect.bottom - rect.top) * 100)}%;`;
	}

	/** The rectangle the outcome of a corner drag highlights. */
	const highlight = $derived.by((): { rect: Rect; label: string } | null => {
		if (splitting) {
			const area = splitting.area ? findArea(graph.screen, splitting.area) : undefined;
			if (!area) return null;
			const r = area.rect;
			const rect =
				splitting.axis === "x" ? { ...r, left: splitting.at } : { ...r, top: splitting.at };
			return { rect, label: "Split" };
		}
		const drag = cornerDrag;
		const outcome = drag?.outcome;
		if (!drag || !outcome) return null;
		const source = findArea(graph.screen, drag.source);
		if (!source) return null;
		if (outcome.kind === "split") {
			const r = source.rect;
			const rect =
				outcome.axis === "x"
					? outcome.side === "before"
						? { ...r, right: outcome.at }
						: { ...r, left: outcome.at }
					: outcome.side === "before"
						? { ...r, bottom: outcome.at }
						: { ...r, top: outcome.at };
			return { rect, label: "Split" };
		}
		const target = findArea(graph.screen, outcome.target);
		if (!target) return null;
		if (outcome.kind === "join") return { rect: target.rect, label: "Join" };
		if (outcome.kind === "swap") return { rect: target.rect, label: "Swap" };
		const r = target.rect;
		const w = r.right - r.left;
		const h = r.bottom - r.top;
		const f = outcome.factor;
		const rect =
			outcome.where === "left"
				? { ...r, right: r.left + w * f }
				: outcome.where === "right"
					? { ...r, left: r.right - w * f }
					: outcome.where === "top"
						? { ...r, bottom: r.top + h * f }
						: outcome.where === "bottom"
							? { ...r, top: r.bottom - h * f }
							: r;
		return { rect, label: outcome.where === "center" ? "Replace" : "Dock" };
	});

	const cursor = $derived(
		splitting
			? splitting.axis === "x"
				? "col-resize"
				: "row-resize"
			: edgeDrag
				? edgeDrag.edge.axis === "x"
					? "col-resize"
					: "row-resize"
				: cornerDrag
					? cornerDrag.outcome
						? cornerDrag.outcome.kind === "split"
							? cornerDrag.outcome.axis === "x"
								? "col-resize"
								: "row-resize"
							: "move"
						: "crosshair"
					: hoverEdge === "x"
						? "col-resize"
						: hoverEdge === "y"
							? "row-resize"
							: undefined,
	);
</script>

<svelte:window
	onpointermove={handleWindowPointerMove}
	onpointerup={finishCornerDrag}
	onkeydowncapture={handleWindowKeydown}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={container}
	class={[
		"bg-muted relative size-full overflow-hidden",
		(edgeDrag ?? cornerDrag ?? splitting) && "select-none",
	]}
	style:cursor
	onpointermovecapture={handlePointerMove}
	onpointerdowncapture={handlePointerDown}
	oncontextmenucapture={handleContextMenuCapture}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	onpointerleave={() => {
		if (!edgeDrag) hoverEdge = null;
	}}
>
	{#each graph.screen.areas as area (area.id)}
		<div
			class={["absolute p-px", maximized && maximized !== area.id && "hidden"]}
			style={style(maximized === area.id ? FULL : area.rect)}
			onpointerenter={() => (hoveredArea = area.id)}
			onpointerleave={() => {
				if (hoveredArea === area.id) hoveredArea = null;
			}}
		>
			<div
				class={[
					"bg-background relative flex size-full flex-col overflow-hidden rounded-md",
					// Gestures over an area shouldn't reach its editor.
					(edgeDrag ?? cornerDrag ?? splitting) && "pointer-events-none",
				]}
			>
				{#if area.editor.type === "graph"}
					<NodeGraph areaId={area.id} />
				{:else if area.editor.type === "preview"}
					<Preview areaId={area.id} />
				{:else}
					<Timeline areaId={area.id} />
				{/if}

				<!-- Corner handles: drag into the area to split it, out to join or dock, with Ctrl to swap. -->
				{#each ["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"] as corner (corner)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class={["absolute z-20 size-3 cursor-crosshair", corner]}
						onpointerdown={(event) => {
							startCornerDrag(area.id, event);
						}}
					></div>
				{/each}
			</div>
		</div>
	{/each}

	<EdgeMenu
		bind:trigger={edgeMenuTrigger}
		axis={edgeMenu.axis}
		canJoinForward={joined(true) !== undefined}
		canJoinBackward={joined(false) !== undefined}
		onsplit={(axis: "x" | "y") => {
			splitting = splitAt(axis, lastPoint);
		}}
		onjoin={(forward: boolean) => apply(joined(forward))}
		onswap={() => apply(swapAreas(graph.screen, edgeMenu.before, edgeMenu.after))}
	/>

	{#if highlight}
		<div
			class="border-primary bg-primary/15 pointer-events-none absolute z-30 flex items-center justify-center rounded-md border-2"
			style={style(highlight.rect)}
		>
			<span class="bg-background/80 rounded px-2 py-0.5 text-xs font-medium"
				>{highlight.label}</span
			>
		</div>
	{/if}
</div>
