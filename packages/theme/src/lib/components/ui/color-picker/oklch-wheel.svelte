<script lang="ts" module>
	/** A little over the most chroma sRGB reaches (about 0.32, in blues). */
	export const OKLCH_MAX_CHROMA = 0.33;
</script>

<script lang="ts">
	import { type Lch, encodeRgb, oklchToLinear } from "$core";

	import { rgbToCss } from "../../../color-css.js";
	import { cn } from "../../../utils.js";
	import { drag } from "./drag.js";
	import { paintGamut } from "./gamut.js";

	let {
		lch,
		maxChroma = OKLCH_MAX_CHROMA,
		disabled = false,
		onchange,
		class: className,
	}: {
		lch: Lch;
		/** The chroma at the rim. */
		maxChroma?: number;
		disabled?: boolean;
		onchange: (next: Pick<Lch, "c" | "h">) => void;
		class?: string;
	} = $props();

	// Hue around and chroma outwards at the colour's lightness, as the HSV
	// wheel: hue 0 at the bottom, going clockwise. Only colours sRGB can show
	// are drawn, so the disc's shape is the gamut's slice at that lightness.
	const HUE_OFFSET = Math.PI;

	// Repainted only when the lightness changes, not while picking.
	const l = $derived(lch.l);
	const paint = $derived.by(() => {
		const lightness = l;
		return paintGamut((x, y) => {
			const dx = x * 2 - 1;
			const dy = y * 2 - 1;
			const radius = Math.hypot(dx, dy);
			if (radius > 1) return undefined;
			const angle = Math.atan2(dx, -dy) - HUE_OFFSET;
			const h = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
			return { l: lightness, c: radius * maxChroma, h };
		});
	});

	const cursor = $derived.by(() => {
		const angle = (lch.h * Math.PI) / 180 + HUE_OFFSET;
		const radius = Math.min(1, lch.c / maxChroma);
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
		"border-border relative aspect-square touch-none rounded-full border border-dashed select-none",
		disabled && "opacity-50",
		className,
	)}
	{@attach pick}
>
	<canvas class="pointer-events-none absolute inset-0 size-full rounded-full" {@attach paint}
	></canvas>
	<div
		class="pointer-events-none absolute size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
		style:left="{50 + cursor.x * 50}%"
		style:top="{50 + cursor.y * 50}%"
		style:background={rgbToCss(encodeRgb(oklchToLinear(lch)))}
	></div>
</div>
