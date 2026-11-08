<script lang="ts" module>
	import {
		type ColorSpace,
		evaluateRamp,
		type RampModes,
		type RampStop,
		type Rgba,
		type Vec4,
	} from "$core";

	import { linearToCss } from "../../color-css.js";

	/** Uniform samples drawing a ramp, on top of a sharp edge at each stop. */
	const SAMPLES = 96;
	const EDGE = 1e-4;

	const vec = ({ r, g, b, a }: Rgba): Vec4 => [r, g, b, a];

	/** A CSS gradient drawing a ramp from left to right, sampled closely enough to look exact. */
	export function rampGradient(
		stops: readonly RampStop[],
		colors: Readonly<Record<string, Rgba>>,
		modes: RampModes,
		alpha: boolean,
		space: ColorSpace,
	): string {
		const colored = stops.map((s) => ({
			position: s.position,
			color: vec(colors[s.id] ?? { r: 0, g: 0, b: 0, a: 1 }),
		}));
		const at = [
			...Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES),
			...stops.flatMap((s) => [Math.max(0, s.position - EDGE), s.position]),
		].sort((a, b) => a - b);
		const parts = at
			.filter((x, i) => x !== at[i - 1])
			.map((x) => {
				const [r, g, b, a] = evaluateRamp(colored, x, modes);
				const css = linearToCss({ r, g, b, a: alpha ? a : 1 }, space);
				return `${css} ${(x * 100).toFixed(3)}%`;
			});
		return `linear-gradient(to right, ${parts.join(", ")})`;
	}
</script>

<script lang="ts">
	import {
		addRampStop,
		distributeRamp,
		flipRamp,
		moveRampStop,
		newStopPosition,
		removeRampStop,
	} from "$core";
	import ArrowsOutLineHorizontalIcon from "phosphor-svelte/lib/ArrowsOutLineHorizontalIcon";
	import FlipHorizontalIcon from "phosphor-svelte/lib/FlipHorizontalIcon";
	import MinusIcon from "phosphor-svelte/lib/MinusIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";

	import { getDisplayGamut } from "../../color-gamut.js";
	import { cn } from "../../utils.js";
	import Scrubbable from "./scrubbable.svelte";

	let {
		stops,
		colors,
		linked,
		modes,
		alpha = false,
		disabled = false,
		onchange,
		class: className,
	}: {
		/** Sorted by position. */
		stops: readonly RampStop[];
		/** Each stop's colour by id, as far as it's known. */
		colors: Readonly<Record<string, Rgba>>;
		/** Stops whose colour is linked, so only known in the shader. */
		linked: ReadonlySet<string>;
		modes: RampModes;
		/** Whether the colours' alpha is drawn (over a checkerboard). */
		alpha?: boolean;
		disabled?: boolean;
		/** New stops, with the colours of those added. */
		onchange: (stops: RampStop[], added: Record<string, Rgba>) => void;
		class?: string;
	} = $props();

	/** How close the pointer must be (in pixels) to grab a stop. */
	const GRAB = 6;
	/** Ctrl-dragged stops snap to 1 / SNAP steps. */
	const SNAP = 20;
	/** How much slower stops move while Shift is held. */
	const PRECISION = 0.1;
	/** Arrow keys move the selected stop by this much (ten times less with Shift). */
	const NUDGE = 0.01;
	const CHECKERBOARD = "repeating-conic-gradient(#999 0 25%, #666 0 50%) 0 0 / 8px 8px";
	/** Hatches a linked stop's marker. */
	const HATCH = "repeating-linear-gradient(45deg, #888 0 2px, #444 2px 4px)";

	const gamut = getDisplayGamut();

	let picked = $state<string | undefined>();
	const selected = $derived(stops.find((s) => s.id === picked) ?? stops[0]);
	const selectedIndex = $derived(stops.findIndex((s) => s.id === selected?.id));

	const gradient = $derived(rampGradient(stops, colors, modes, alpha, gamut()));

	let lane = $state<HTMLDivElement>();
	let width = $state(0);

	type Drag = {
		pointer: number;
		id: string;
		origin: number;
		/** How far the pointer has moved, in pixels, slowed while Shift is held. */
		moved: number;
		last: number;
		/** The ramp as last sent, which `stops` may not reflect yet. */
		stops: readonly RampStop[];
	};
	let drag: Drag | undefined;

	/** The pointer's x in the lane's own pixels, which a zoomed-in canvas scales. */
	function local(event: MouseEvent): number {
		const rect = lane?.getBoundingClientRect();
		if (!rect || width === 0) return 0;
		return (event.clientX - rect.left) / (rect.width / width);
	}

	const toPx = (position: number) => position * width;

	function nearest(x: number): RampStop | undefined {
		let best: RampStop | undefined;
		let distance = Infinity;
		// The last of stops on top of each other is drawn above, so it's grabbed first.
		for (const stop of stops.toReversed()) {
			const d = Math.abs(toPx(stop.position) - x);
			if (d < distance) {
				distance = d;
				best = stop;
			}
		}
		return best;
	}

	function colorAt(list: readonly RampStop[], position: number): Rgba {
		const colored = list.map((s) => ({
			position: s.position,
			color: vec(colors[s.id] ?? { r: 0, g: 0, b: 0, a: 1 }),
		}));
		const [r, g, b, a] = evaluateRamp(colored, position, modes);
		return { r, g, b, a };
	}

	function add(position: number): { stops: RampStop[]; stop: RampStop } {
		const added = addRampStop(stops, position);
		onchange(added.stops, { [added.stop.id]: colorAt(stops, added.stop.position) });
		picked = added.stop.id;
		return added;
	}

	function remove() {
		if (!selected || stops.length <= 1) return;
		const index = selectedIndex;
		const next = removeRampStop(stops, selected.id);
		picked = next[Math.min(index, next.length - 1)]?.id;
		onchange(next, {});
	}

	function send(next: RampStop[]) {
		if (drag) drag.stops = next;
		onchange(next, {});
	}

	function press(event: PointerEvent) {
		if (disabled || event.button !== 0 || !lane) return;
		lane.focus();
		const x = local(event);
		const near = nearest(x);
		// Ctrl-click adds a stop, as in Blender; a click grabs the nearest one.
		const { stop, stops: next } =
			event.ctrlKey || event.metaKey || !near
				? add(x / Math.max(1, width))
				: { stop: near, stops };
		picked = stop.id;
		drag = {
			pointer: event.pointerId,
			id: stop.id,
			origin: stop.position,
			moved: 0,
			last: x,
			stops: next,
		};
		lane.setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent) {
		if (drag?.pointer !== event.pointerId) return;
		const x = local(event);
		drag.moved += (x - drag.last) * (event.shiftKey ? PRECISION : 1);
		drag.last = x;
		const target = drag.origin + drag.moved / Math.max(1, width);
		const snapped = event.ctrlKey || event.metaKey ? Math.round(target * SNAP) / SNAP : target;
		send(moveRampStop(drag.stops, drag.id, snapped));
	}

	function release(event: PointerEvent) {
		if (drag?.pointer === event.pointerId) drag = undefined;
	}

	function keydown(event: KeyboardEvent) {
		if (disabled || !selected) return;
		if (event.key === "Delete" || event.key === "Backspace") {
			remove();
		} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			const step =
				(event.shiftKey ? NUDGE / 10 : NUDGE) * (event.key === "ArrowLeft" ? -1 : 1);
			onchange(moveRampStop(stops, selected.id, selected.position + step), {});
		} else if (event.key === "Escape") {
			lane?.blur();
		} else {
			return;
		}
		// Editing the ramp, not the graph around it.
		event.preventDefault();
		event.stopPropagation();
	}

	const markerColor = (stop: RampStop) =>
		linked.has(stop.id)
			? HATCH
			: linearToCss({ ...(colors[stop.id] ?? { r: 0, g: 0, b: 0, a: 1 }), a: 1 }, gamut());

	const toolClass =
		"hover:bg-foreground/10 flex size-6 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-40";
</script>

<!-- Keys pressed in here edit the ramp, never the graph around it. -->
<div class={cn("nokey flex flex-col gap-1", disabled && "opacity-60", className)}>
	<div class="flex items-center gap-0.5">
		<button
			type="button"
			class={toolClass}
			title="Add a stop"
			aria-label="Add a stop"
			{disabled}
			onclick={() => add(newStopPosition(stops, selected?.id))}
		>
			<PlusIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class={toolClass}
			title="Remove the selected stop"
			aria-label="Remove the selected stop"
			disabled={disabled || stops.length <= 1}
			onclick={remove}
		>
			<MinusIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class={cn(toolClass, "ml-auto")}
			title="Flip left to right"
			aria-label="Flip left to right"
			{disabled}
			onclick={() => onchange(flipRamp(stops), {})}
		>
			<FlipHorizontalIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class={toolClass}
			title="Space the stops evenly"
			aria-label="Space the stops evenly"
			disabled={disabled || stops.length < 2}
			onclick={() => onchange(distributeRamp(stops), {})}
		>
			<ArrowsOutLineHorizontalIcon class="size-3.5" />
		</button>
	</div>

	<div
		bind:this={lane}
		bind:clientWidth={width}
		class="nodrag nowheel focus-visible:ring-ring/50 relative mx-1 touch-none rounded-sm outline-none select-none focus-visible:ring-2 {disabled
			? ''
			: 'cursor-ew-resize'}"
		role="slider"
		aria-label="Color ramp: drag a stop to move it, Ctrl-click or double-click to add one, Delete removes the selected one"
		aria-valuemin={0}
		aria-valuemax={1}
		aria-valuenow={selected?.position ?? 0}
		tabindex={disabled ? -1 : 0}
		onpointerdown={press}
		onpointermove={move}
		onpointerup={release}
		onpointercancel={release}
		onkeydown={keydown}
		ondblclick={(event) => {
			const x = local(event);
			const near = nearest(x);
			if (!disabled && (!near || Math.abs(toPx(near.position) - x) > GRAB)) {
				add(x / Math.max(1, width));
			}
		}}
		oncontextmenu={(event) => {
			// Ctrl-click adds a stop: on macOS it opens context menus too.
			event.preventDefault();
			event.stopPropagation();
		}}
	>
		<div
			class="h-6 overflow-hidden rounded-sm ring-1 ring-black/20"
			style:background={alpha ? CHECKERBOARD : undefined}
		>
			<div class="size-full" style:background={gradient}></div>
		</div>
		<!-- Room for the markers under the bar. -->
		<div class="h-3"></div>
		{#each stops as stop (stop.id)}
			{@const active = stop.id === selected?.id}
			<div
				class="pointer-events-none absolute inset-y-0 flex -translate-x-1/2 flex-col items-center"
				style:left="{toPx(stop.position)}px"
				style:z-index={active ? 1 : undefined}
			>
				<!-- A line across the bar, visible on any colour. -->
				<div
					class={cn(
						"h-6 w-0.75 border-x border-black/60",
						active ? "bg-white" : "bg-white/70",
					)}
				></div>
				<div
					class={cn(
						"h-3 w-2.5 rounded-b-sm ring-1",
						active ? "ring-primary ring-2" : "ring-black/50",
					)}
					style:background={markerColor(stop)}
				></div>
			</div>
		{/each}
	</div>

	<div class="flex items-center gap-1 px-1 text-xs">
		<span class="text-muted-foreground shrink-0">
			Stop {selectedIndex + 1}{selected && linked.has(selected.id) ? " (linked)" : ""}
		</span>
		<Scrubbable
			label="Position"
			class="min-w-0 flex-1 [&_input]:h-6"
			min={0}
			max={1}
			readonly={disabled || !selected}
			value={selected?.position ?? 0}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				if (selected) {
					onchange(
						moveRampStop(stops, selected.id, parseFloat(e.currentTarget.value) || 0),
						{},
					);
				}
			}}
		/>
	</div>
</div>
