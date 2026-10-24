<script lang="ts">
	import { readComponent } from "$core";
	import { ColorPicker, linearToCss, Popover, type Rgba } from "$theme";

	import type { ControlProps } from "./types";

	let { type, value, disabled, onchange }: ControlProps<{ kind: "color" }> = $props();

	// Shows through the alpha half of the swatch.
	const CHECKERBOARD = "repeating-conic-gradient(#999 0 25%, #666 0 50%) 0 0 / 12px 12px";

	const alpha = $derived(type === "vec4f");
	const color = $derived<Rgba>({
		r: readComponent(value, "x"),
		g: readComponent(value, "y"),
		b: readComponent(value, "z"),
		a: alpha ? readComponent(value, "w") : 1,
	});

	function set({ r, g, b, a }: Rgba) {
		// Edited as RGB, the alpha is kept (opaque if never set) for when the
		// input becomes RGBA.
		const w = alpha ? a : typeof value === "object" ? (value.w ?? 1) : 1;
		onchange({ x: r, y: g, z: b, w });
	}
</script>

<Popover.Root>
	<Popover.Trigger
		{disabled}
		aria-label="Edit colour"
		style="background: {CHECKERBOARD}"
		class="nodrag flex h-8 w-full overflow-hidden rounded-sm ring-1 ring-black/20 disabled:opacity-50"
	>
		<!-- Opaque on the left, with its alpha on the right (as Blender). -->
		<span class="h-full flex-1" style:background={linearToCss({ ...color, a: 1 })}></span>
		{#if alpha}
			<span class="h-full flex-1" style:background={linearToCss(color)}></span>
		{/if}
	</Popover.Trigger>
	<Popover.Content class="w-auto" side="right" align="start">
		<ColorPicker value={color} {alpha} onchange={set} />
	</Popover.Content>
</Popover.Root>
