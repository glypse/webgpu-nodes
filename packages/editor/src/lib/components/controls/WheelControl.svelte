<script lang="ts">
	import { decodeRgb, encodeRgb, type Hsv, hsvToRgb, readComponent, rgbToHsv } from "$core";
	import { ColorValueRamp, ColorWheel, Scrubbable } from "$theme";
	import { untrack } from "svelte";

	import type { ControlProps } from "./types";

	let { type, value, disabled, onchange }: ControlProps<{ kind: "wheel" }> = $props();

	const EPSILON = 1e-6;
	const alpha = $derived(type === "vec4f");
	const rgb = $derived({
		r: readComponent(value, "x"),
		g: readComponent(value, "y"),
		b: readComponent(value, "z"),
	});
	const a = $derived(typeof value === "object" ? readComponent(value, "w") : 1);

	// Kept apart from the value so a hue survives going through grey or
	// black, as in Blender.
	let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
	/** The colour last written, to tell our own edits coming back from new ones. */
	let sent: { r: number; g: number; b: number } | undefined;

	$effect.pre(() => {
		const current = rgb;
		const ours =
			sent !== undefined &&
			(["r", "g", "b"] as const).every(
				(k) => Math.abs((sent?.[k] ?? 0) - current[k]) < EPSILON,
			);
		if (ours) return;
		untrack(() => {
			const next = rgbToHsv(encodeRgb(current));
			if (next.v < EPSILON) hsv = { ...hsv, v: 0 };
			else hsv = next.s < EPSILON ? { ...next, h: hsv.h } : next;
		});
	});

	function write(color: { r: number; g: number; b: number }, w: number) {
		sent = color;
		onchange({ x: color.r, y: color.g, z: color.b, w });
	}

	function set(patch: Partial<Hsv>) {
		hsv = { ...hsv, ...patch };
		write(decodeRgb(hsvToRgb(hsv)), a);
	}
</script>

<div class="nodrag nowheel flex flex-col gap-1 py-1">
	<div class="flex gap-2">
		<ColorWheel class="min-w-0 flex-1" {hsv} {disabled} onchange={set} />
		<ColorValueRamp
			{hsv}
			{disabled}
			onchange={(v: number) => {
				set({ v });
			}}
		/>
	</div>
	{#if alpha}
		<Scrubbable
			class="node-shell__input"
			readonly={disabled}
			min={0}
			value={a}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				write(rgb, Math.min(1, parseFloat(e.currentTarget.value) || 0));
			}}
		/>
	{/if}
</div>
