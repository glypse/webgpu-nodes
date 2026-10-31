<script lang="ts" module>
	import { type CurvePoint, type Vec2, curveSegments } from "$core";

	/** An SVG path of a curve across the whole square, `at` placing its points. */
	export function curvePath(points: readonly CurvePoint[], at: (p: Vec2) => Vec2): string {
		const first = points[0];
		const last = points[points.length - 1];
		if (!first || !last) return "";
		const f = (p: Vec2) => {
			const q = at(p);
			return `${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
		};
		const parts = [`M ${f({ x: 0, y: first.y })}`, `L ${f(first)}`];
		for (const [, c0, c1, end] of curveSegments(points)) {
			parts.push(`C ${f(c0)} ${f(c1)} ${f(end)}`);
		}
		parts.push(`L ${f({ x: 1, y: last.y })}`);
		return parts.join(" ");
	}
</script>

<script lang="ts">
	import {
		CURVE_PRESETS,
		type CurvePointKind,
		addCurvePoint,
		flipCurveX,
		flipCurveY,
		insertCurvePoint,
		moveCurveHandle,
		moveCurvePoint,
		pointHandles,
		removeCurvePoint,
		segmentPoint,
		setCurvePointKind,
	} from "$core";
	import FlipHorizontalIcon from "phosphor-svelte/lib/FlipHorizontalIcon";
	import FlipVerticalIcon from "phosphor-svelte/lib/FlipVerticalIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { cn } from "../../utils.js";
	import Scrubbable from "./scrubbable.svelte";

	let {
		points,
		disabled = false,
		onchange,
		class: className,
	}: {
		points: readonly CurvePoint[];
		disabled?: boolean;
		onchange: (points: CurvePoint[]) => void;
		class?: string;
	} = $props();

	/** Room around the square, so points on its edges are drawn whole. */
	const INSET = 6;
	/** How close the pointer must be (in pixels) to grab a point or a handle. */
	const GRAB = 7;
	/** How close the pointer must be (in pixels) to the curve to add a point on it. */
	const CURVE_GRAB = 5;
	/** Ctrl-dragged points snap to 1 / SNAP steps, as in Blender. */
	const SNAP = 8;
	/** How much slower things move while Shift is held. */
	const PRECISION = 0.1;
	const GRID = [0.25, 0.5, 0.75];

	/** Each kind's button, its glyph drawn in a 16 × 16 box. */
	const KINDS: {
		kind: CurvePointKind;
		label: string;
		lines: string;
		point: Vec2;
		handles: Vec2[];
	}[] = [
		{
			kind: "vector",
			label: "Vector: no handles, straight to its neighbours",
			lines: "M2 13 L8 4 L14 13",
			point: { x: 8, y: 4 },
			handles: [],
		},
		{
			kind: "free",
			label: "Free: each handle goes its own way",
			lines: "M3 4 L8 10 L14 7",
			point: { x: 8, y: 10 },
			handles: [
				{ x: 3, y: 4 },
				{ x: 14, y: 7 },
			],
		},
		{
			kind: "aligned",
			label: "Aligned: opposite handles, each with its length",
			lines: "M2.5 11 L13 5",
			point: { x: 6.5, y: 9 },
			handles: [
				{ x: 2.5, y: 11 },
				{ x: 13, y: 5 },
			],
		},
		{
			kind: "mirrored",
			label: "Mirrored: opposite handles of the same length",
			lines: "M2 8 L14 8",
			point: { x: 8, y: 8 },
			handles: [
				{ x: 2, y: 8 },
				{ x: 14, y: 8 },
			],
		},
	];

	let svg = $state<SVGSVGElement>();
	let size = $state(0);
	const span = $derived(Math.max(1, size - 2 * INSET));

	const toPx = (p: Vec2): Vec2 => ({ x: INSET + p.x * span, y: INSET + (1 - p.y) * span });
	const fromPx = (p: Vec2): Vec2 => ({ x: (p.x - INSET) / span, y: 1 - (p.y - INSET) / span });

	let selected = $state<number | undefined>();
	const active = $derived(selected === undefined ? undefined : points[selected]);

	/** The handles drawn around a point: an end point's outer one shapes nothing. */
	function sides(index: number): ("left" | "right")[] {
		const point = points[index];
		if (!point || point.kind === "vector") return [];
		return (["left", "right"] as const).filter(
			(side) =>
				!(side === "left" && index === 0) &&
				!(side === "right" && index === points.length - 1),
		);
	}

	const handleAt = (point: CurvePoint, side: "left" | "right"): Vec2 =>
		toPx({ x: point.x + point[side].x, y: point.y + point[side].y });

	const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

	function grabbedHandle(m: Vec2): "left" | "right" | undefined {
		if (!active || selected === undefined) return undefined;
		const point = active;
		return sides(selected).find((side) => distance(handleAt(point, side), m) < GRAB);
	}

	function grabbedPoint(m: Vec2): number | undefined {
		let nearest: number | undefined;
		let best = GRAB;
		points.forEach((p, i) => {
			const d = distance(toPx(p), m);
			if (d < best) {
				best = d;
				nearest = i;
			}
		});
		return nearest;
	}

	function segmentDistance(m: Vec2, a: Vec2, b: Vec2): number {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSq = dx * dx + dy * dy;
		const t =
			lengthSq === 0
				? 0
				: Math.min(1, Math.max(0, ((m.x - a.x) * dx + (m.y - a.y) * dy) / lengthSq));
		return distance(m, { x: a.x + t * dx, y: a.y + t * dy });
	}

	function onCurve(m: Vec2): boolean {
		const first = points[0];
		const last = points[points.length - 1];
		if (!first || !last) return false;
		const line: Vec2[] = [{ x: 0, y: first.y }];
		for (const segment of curveSegments(points)) {
			for (let i = 0; i <= 24; i++) line.push(segmentPoint(segment, i / 24));
		}
		line.push({ x: 1, y: last.y });
		const px = line.map(toPx);
		return px.some((a, i) => {
			const b = px[i + 1];
			return b !== undefined && segmentDistance(m, a, b) < CURVE_GRAB;
		});
	}

	type Drag = {
		pointer: number;
		/** What's dragged: a point, or one of its handles. */
		part: "point" | "left" | "right";
		index: number;
		/** Where the point, or the handle's offset, was when the drag started. */
		origin: Vec2;
		/** How far the pointer has moved, in pixels, slowed while Shift is held. */
		moved: Vec2;
		last: Vec2;
		/** The curve as last sent, which `points` may not reflect yet. */
		points: readonly CurvePoint[];
	};
	let drag: Drag | undefined;

	/** The pointer in the graph's own pixels, which a zoomed-in canvas scales. */
	function local(event: PointerEvent): Vec2 {
		const rect = svg?.getBoundingClientRect();
		if (!rect || size === 0) return { x: 0, y: 0 };
		const zoom = rect.width / size;
		return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
	}

	function send(next: CurvePoint[]) {
		if (drag) drag.points = next;
		onchange(next);
	}

	function press(event: PointerEvent) {
		if (disabled || event.button !== 0 || !svg) return;
		svg.focus();
		const m = local(event);
		let next: readonly CurvePoint[] = points;
		let part: Drag["part"] = "point";
		let index: number | undefined;
		const side = grabbedHandle(m);
		if (side && selected !== undefined) {
			part = side;
			index = selected;
		} else {
			index = grabbedPoint(m);
			if (index === undefined && (event.ctrlKey || event.metaKey)) {
				const at = fromPx(m);
				({ points: next, index } = addCurvePoint(points, at.x, at.y));
			} else if (index === undefined && onCurve(m)) {
				({ points: next, index } = insertCurvePoint(points, fromPx(m).x));
			}
		}
		selected = index;
		const point = index === undefined ? undefined : next[index];
		if (index === undefined || !point) return;
		if (next !== points) onchange([...next]);
		drag = {
			pointer: event.pointerId,
			part,
			index,
			origin: part === "point" ? { x: point.x, y: point.y } : point[part],
			moved: { x: 0, y: 0 },
			last: m,
			points: next,
		};
		svg.setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent) {
		if (drag?.pointer !== event.pointerId) return;
		const scale = event.shiftKey ? PRECISION : 1;
		const m = local(event);
		drag.moved = {
			x: drag.moved.x + (m.x - drag.last.x) * scale,
			y: drag.moved.y + (m.y - drag.last.y) * scale,
		};
		drag.last = m;
		const target = {
			x: drag.origin.x + drag.moved.x / span,
			y: drag.origin.y - drag.moved.y / span,
		};
		if (drag.part === "point") {
			const snap = (n: number) =>
				event.ctrlKey || event.metaKey ? Math.round(n * SNAP) / SNAP : n;
			send(moveCurvePoint(drag.points, drag.index, snap(target.x), snap(target.y)));
		} else {
			send(moveCurveHandle(drag.points, drag.index, drag.part, target));
		}
	}

	function release(event: PointerEvent) {
		if (drag?.pointer === event.pointerId) drag = undefined;
	}

	function remove() {
		if (selected === undefined || points.length <= 2) return;
		onchange(removeCurvePoint(points, selected));
		selected = undefined;
	}

	function keydown(event: KeyboardEvent) {
		if (disabled) return;
		if (event.key === "Delete" || event.key === "Backspace") {
			remove();
		} else if (event.key === "Escape") {
			selected = undefined;
		} else {
			return;
		}
		// Deleting a point, not the node.
		event.preventDefault();
		event.stopPropagation();
	}

	function setKind(kind: CurvePointKind) {
		if (selected !== undefined) onchange(setCurvePointKind(points, selected, kind));
	}

	type Part = "point" | "left" | "right";
	const PARTS: { part: Part; label: string }[] = [
		{ part: "point", label: "Point" },
		{ part: "left", label: "Left" },
		{ part: "right", label: "Right" },
	];

	/** Where a part of the selected point is in the square. */
	function partAt(point: CurvePoint, part: Part): Vec2 {
		if (part === "point") return point;
		const handle = pointHandles(point)[part];
		return { x: point.x + handle.x, y: point.y + handle.y };
	}

	function editable(part: Part): boolean {
		if (disabled || selected === undefined) return false;
		return part === "point" || sides(selected).includes(part);
	}

	function setCoordinate(part: Part, axis: "x" | "y", raw: string) {
		if (selected === undefined || !active) return;
		const at = { ...partAt(active, part), [axis]: parseFloat(raw) || 0 };
		onchange(
			part === "point"
				? moveCurvePoint(points, selected, at.x, at.y)
				: moveCurveHandle(points, selected, part, {
						x: at.x - active.x,
						y: at.y - active.y,
					}),
		);
	}

	function flip(axis: "x" | "y") {
		if (axis === "x") {
			if (selected !== undefined) selected = points.length - 1 - selected;
			onchange(flipCurveX(points));
		} else {
			onchange(flipCurveY(points));
		}
	}

	function applyPreset(preset: readonly CurvePoint[]) {
		selected = undefined;
		onchange([...preset]);
	}

	const path = $derived(size > 0 ? curvePath(points, toPx) : "");
	const fill = $derived.by(() => {
		if (!path) return "";
		const end = toPx({ x: 1, y: 0 });
		const start = toPx({ x: 0, y: 0 });
		return `${path} L ${end.x.toFixed(2)} ${end.y.toFixed(2)} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} Z`;
	});
	const thumb = (p: Vec2): Vec2 => ({ x: 3 + p.x * 14, y: 3 + (1 - p.y) * 14 });
</script>

{#snippet kindGlyph({ lines, point, handles }: (typeof KINDS)[number])}
	<svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.25">
		<path d={lines} />
		{#each handles as handle, i (i)}
			<circle cx={handle.x} cy={handle.y} r="1.5" />
		{/each}
		<circle cx={point.x} cy={point.y} r="2" fill="currentColor" stroke="none" />
	</svg>
{/snippet}

<!-- Keys pressed in here edit the curve, never the graph around it. -->
<div class={cn("nokey flex flex-col gap-1", disabled && "opacity-60", className)}>
	<div class="flex gap-1">
		<div class="relative aspect-square min-w-0 flex-1" bind:clientWidth={size}>
			<svg
				bind:this={svg}
				class="nodrag nowheel bg-foreground/5 focus-visible:ring-ring/50 absolute inset-0 size-full touch-none rounded-sm outline-none select-none focus-visible:ring-2 {disabled
					? ''
					: 'cursor-crosshair'}"
				role="application"
				aria-label="Curve: click the curve to add a point, Ctrl-click to add one anywhere, Delete removes the selected one"
				tabindex={disabled ? -1 : 0}
				onpointerdown={press}
				onpointermove={move}
				onpointerup={release}
				onpointercancel={release}
				onkeydown={keydown}
				oncontextmenu={(event) => {
					// Ctrl-click adds a point: on macOS it opens context menus too.
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				{#each GRID as g (g)}
					{@const a = toPx({ x: g, y: 0 })}
					{@const b = toPx({ x: 0, y: g })}
					<line
						x1={a.x}
						x2={a.x}
						y1={INSET}
						y2={INSET + span}
						class="stroke-foreground/10"
					/>
					<line
						y1={b.y}
						y2={b.y}
						x1={INSET}
						x2={INSET + span}
						class="stroke-foreground/10"
					/>
				{/each}
				<rect
					x={INSET}
					y={INSET}
					width={span}
					height={span}
					fill="none"
					class="stroke-foreground/15"
				/>
				<path d={fill} class="fill-foreground/5" />
				<path d={path} fill="none" class="stroke-foreground" stroke-width="1.5" />

				{#if active && selected !== undefined}
					{@const at = toPx(active)}
					{#each sides(selected) as side (side)}
						{@const handle = handleAt(active, side)}
						<line
							x1={at.x}
							y1={at.y}
							x2={handle.x}
							y2={handle.y}
							class="stroke-primary/70"
						/>
						<circle
							cx={handle.x}
							cy={handle.y}
							r="3"
							class="fill-card stroke-primary"
							stroke-width="1.5"
						/>
					{/each}
				{/if}

				{#each points as point, i (i)}
					{@const at = toPx(point)}
					<circle
						cx={at.x}
						cy={at.y}
						r={i === selected ? 4.5 : 3.5}
						class={i === selected
							? "fill-primary stroke-card"
							: "fill-foreground stroke-card"}
						stroke-width="1.5"
					/>
				{/each}
			</svg>
		</div>

		<div class="flex flex-col justify-between">
			{#each CURVE_PRESETS as preset (preset.id)}
				<button
					type="button"
					class="hover:bg-foreground/10 text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none"
					title="{preset.label} preset"
					aria-label="{preset.label} preset"
					{disabled}
					onclick={() => applyPreset(preset.points)}
				>
					<svg viewBox="0 0 20 20" class="size-full" fill="none" stroke="currentColor">
						<path d={curvePath(preset.points, thumb)} stroke-width="1.5" />
					</svg>
				</button>
			{/each}
		</div>
	</div>

	<div class="flex items-center gap-0.5">
		{#each KINDS as glyph (glyph.kind)}
			{@const { kind, label } = glyph}
			<button
				type="button"
				class={cn(
					"hover:bg-foreground/10 flex size-6 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-40",
					active?.kind === kind && "bg-foreground/15",
				)}
				title={label}
				aria-label={label}
				aria-pressed={active?.kind === kind}
				disabled={disabled || !active}
				onclick={() => setKind(kind)}
			>
				{@render kindGlyph(glyph)}
			</button>
		{/each}
		<button
			type="button"
			class="hover:bg-foreground/10 ml-auto flex size-6 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-40"
			title="Flip left to right"
			aria-label="Flip left to right"
			{disabled}
			onclick={() => flip("x")}
		>
			<FlipHorizontalIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class="hover:bg-foreground/10 flex size-6 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-40"
			title="Flip upside down"
			aria-label="Flip upside down"
			{disabled}
			onclick={() => flip("y")}
		>
			<FlipVerticalIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class="hover:bg-destructive/20 hover:text-destructive flex size-6 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-40"
			title="Delete point"
			aria-label="Delete point"
			disabled={disabled || !active || points.length <= 2}
			onclick={remove}
		>
			<XIcon class="size-3.5" />
		</button>
	</div>

	<!-- Handles are placed in the square too, not relative to their point. -->
	<div class="grid grid-cols-[auto_1fr_1fr] items-center gap-x-1 gap-y-0.5 text-xs">
		{#each PARTS as { part, label } (part)}
			{@const at = active ? partAt(active, part) : undefined}
			<span class="text-muted-foreground pr-0.5">{label}</span>
			{#each ["x", "y"] as const as axis (axis)}
				<div class="flex min-w-0 items-center">
					<Scrubbable
						label={axis.toUpperCase()}
						class="[&_input]:h-6"
						min={part === "point" ? 0 : undefined}
						max={part === "point" ? 1 : undefined}
						readonly={!editable(part)}
						value={at?.[axis] ?? 0}
						oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
							setCoordinate(part, axis, e.currentTarget.value);
						}}
					/>
				</div>
			{/each}
		{/each}
	</div>
</div>
