<script lang="ts">
	import { type Hsv, hsvToRgb } from "$core";

	import { rgbToCss } from "../../../color-css.js";
	import { cn } from "../../../utils.js";
	import { drag } from "./drag.js";

	let {
		hsv,
		disabled = false,
		onchange,
		class: className,
	}: {
		/** sRGB-encoded HSV. */
		hsv: Hsv;
		disabled?: boolean;
		onchange: (v: number) => void;
		class?: string;
	} = $props();

	const pick = drag((event, rect) => {
		if (disabled) return;
		onchange(Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height)));
	});
</script>

<div
	role="slider"
	tabindex="-1"
	aria-label="Value"
	aria-valuenow={hsv.v}
	aria-disabled={disabled}
	class={cn(
		"relative w-3 shrink-0 touch-none rounded-sm select-none",
		disabled && "opacity-50",
		className,
	)}
	style:background="linear-gradient({rgbToCss(hsvToRgb({ ...hsv, v: 1 }))}, black)"
	{@attach pick}
>
	<div
		class="pointer-events-none absolute inset-x-[-2px] h-1.5 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
		style:top="{(1 - hsv.v) * 100}%"
	></div>
</div>
