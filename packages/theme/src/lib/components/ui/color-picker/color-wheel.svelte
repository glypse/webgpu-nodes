<script lang="ts">
	import { type Hsv, hsvToRgb } from "../../../color.js";
	import { cn } from "../../../utils.js";
	import { drag } from "./drag.js";

	let {
		hsv,
		onchange,
		class: className,
	}: {
		hsv: Hsv;
		onchange: (next: Pick<Hsv, "h" | "s">) => void;
		class?: string;
	} = $props();

	// Red at the bottom, hues going clockwise (as Blender's wheel). Angles are
	// clockwise from the top, as `conic-gradient` measures them.
	const HUE_OFFSET = Math.PI;
	// Hues around, saturation fading to white at the centre.
	const WHEEL =
		"radial-gradient(closest-side, white, transparent), " +
		"conic-gradient(from 180deg, red, yellow, lime, cyan, blue, magenta, red)";

	const cursor = $derived.by(() => {
		const angle = hsv.h * 2 * Math.PI + HUE_OFFSET;
		return { x: Math.sin(angle) * hsv.s, y: -Math.cos(angle) * hsv.s };
	});

	const pick = drag((event, rect) => {
		const dx = (event.clientX - rect.left) / (rect.width / 2) - 1;
		const dy = (event.clientY - rect.top) / (rect.height / 2) - 1;
		const angle = Math.atan2(dx, -dy) - HUE_OFFSET;
		const turn = angle / (2 * Math.PI);
		onchange({ h: turn - Math.floor(turn), s: Math.min(1, Math.hypot(dx, dy)) });
	});

	const toCss = ({ r, g, b }: { r: number; g: number; b: number }) =>
		`rgb(${String(r * 255)} ${String(g * 255)} ${String(b * 255)})`;
</script>

<div
	role="slider"
	tabindex="-1"
	aria-label="Hue and saturation"
	aria-valuenow={hsv.h}
	class={cn("relative aspect-square touch-none rounded-full select-none", className)}
	style:background={WHEEL}
	{@attach pick}
>
	<div
		class="pointer-events-none absolute inset-0 rounded-full bg-black"
		style:opacity={1 - hsv.v}
	></div>
	<div
		class="pointer-events-none absolute size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
		style:left="{50 + cursor.x * 50}%"
		style:top="{50 + cursor.y * 50}%"
		style:background={toCss(hsvToRgb(hsv))}
	></div>
</div>
