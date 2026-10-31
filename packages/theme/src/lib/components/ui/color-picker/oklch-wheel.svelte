<script lang="ts" module>
	import type { ColorSpace } from "$core";

	/** A little over the most chroma each gamut reaches (about 0.32 and 0.36). */
	export const OKLCH_MAX_CHROMA: Record<ColorSpace, number> = { srgb: 0.33, "display-p3": 0.37 };
</script>

<script lang="ts">
	import { type Lch, oklchToLinear } from "$core";

	import { linearToCss } from "../../../color-css.js";
	import { getDisplayGamut } from "../../../color-gamut.js";
	import { cn } from "../../../utils.js";
	import { drag } from "./drag.js";
	import { paintGamut } from "./gamut.js";

	let {
		lch,
		maxChroma: maxChromaProp,
		disabled = false,
		onchange,
		class: className,
	}: {
		lch: Lch;
		/** The chroma at the rim, by default a little over the gamut's. */
		maxChroma?: number;
		disabled?: boolean;
		onchange: (next: Pick<Lch, "c" | "h">) => void;
		class?: string;
	} = $props();

	// Hue around and chroma outwards at the colour's lightness, as the HSV
	// wheel: hue 0 at the bottom, going clockwise. A line traces the gamut's
	// slice at that lightness; outside it, colours show what they're mapped to.
	const HUE_OFFSET = Math.PI;

	const gamut = getDisplayGamut();
	const maxChroma = $derived(maxChromaProp ?? OKLCH_MAX_CHROMA[gamut()]);

	// Repainted only when the lightness or the gamut changes, not while picking.
	const l = $derived(lch.l);
	const paint = $derived.by(() => {
		const lightness = l;
		const chroma = maxChroma;
		return paintGamut((x, y) => {
			const dx = x * 2 - 1;
			const dy = y * 2 - 1;
			const radius = Math.hypot(dx, dy);
			if (radius > 1) return undefined;
			const angle = Math.atan2(dx, -dy) - HUE_OFFSET;
			const h = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
			return { l: lightness, c: radius * chroma, h };
		}, gamut());
	});

	const cursor = $derived.by(() => {
		const angle = (lch.h * Math.PI) / 180 + HUE_OFFSET;
		const radius = Math.min(1, Math.max(0, lch.c / maxChroma));
		return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius };
	});

	const pick = drag((event, rect) => {
		if (disabled) return;
		const dx = (event.clientX - rect.left) / (rect.width / 2) - 1;
		const dy = (event.clientY - rect.top) / (rect.height / 2) - 1;
		const angle = Math.atan2(dx, -dy) - HUE_OFFSET;
		const h = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
		onchange({ h, c: Math.min(1, Math.hypot(dx, dy)) * maxChroma });
	});
</script>

<div
	role="slider"
	tabindex="-1"
	aria-label="Hue and chroma"
	aria-valuenow={lch.h}
	aria-disabled={disabled}
	class={cn(
		"relative aspect-square touch-none rounded-full select-none",
		disabled && "opacity-50",
		className,
	)}
	{@attach pick}
>
	{#key gamut()}
		<canvas class="pointer-events-none absolute inset-0 size-full rounded-full" {@attach paint}
		></canvas>
	{/key}
	<div
		class="pointer-events-none absolute size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
		style:left="{50 + cursor.x * 50}%"
		style:top="{50 + cursor.y * 50}%"
		style:background={linearToCss({ ...oklchToLinear(lch, gamut()), a: 1 }, gamut())}
	></div>
</div>
