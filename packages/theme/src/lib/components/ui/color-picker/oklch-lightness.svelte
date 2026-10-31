<script lang="ts">
	import type { Lch } from "$core";

	import { getDisplayGamut } from "../../../color-gamut.js";
	import { cn } from "../../../utils.js";
	import { drag } from "./drag.js";
	import { paintGamut } from "./gamut.js";

	let {
		lch,
		disabled = false,
		onchange,
		class: className,
	}: {
		lch: Lch;
		disabled?: boolean;
		onchange: (l: number) => void;
		class?: string;
	} = $props();

	// Lightness from 1 at the top to 0 at the bottom, at the colour's chroma
	// and hue; lines mark where it leaves the gamut.
	const gamut = getDisplayGamut();
	const c = $derived(lch.c);
	const h = $derived(lch.h);
	const paint = $derived.by(() => {
		const [chroma, hue] = [c, h];
		return paintGamut((_, y) => ({ l: 1 - y, c: chroma, h: hue }), gamut());
	});

	const pick = drag((event, rect) => {
		if (disabled) return;
		onchange(Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height)));
	});
</script>

<div
	role="slider"
	tabindex="-1"
	aria-label="Lightness"
	aria-valuenow={lch.l}
	aria-disabled={disabled}
	class={cn(
		"relative w-3 shrink-0 touch-none rounded-sm select-none",
		disabled && "opacity-50",
		className,
	)}
	{@attach pick}
>
	{#key gamut()}
		<canvas class="pointer-events-none absolute inset-0 size-full rounded-sm" {@attach paint}
		></canvas>
	{/key}
	<div
		class="pointer-events-none absolute inset-x-[-2px] h-1.5 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
		style:top="{(1 - Math.min(1, Math.max(0, lch.l))) * 100}%"
	></div>
</div>
