<script lang="ts">
	import { type ColorComponents, readComponent } from "$core";
	import { ColorWheels, Scrubbable } from "$theme";

	import type { ControlProps } from "./types";

	let { type, value, disabled, onchange }: ControlProps<{ kind: "wheel" }> = $props();

	const alpha = $derived(type === "vec4f");
	const rgb = $derived<ColorComponents>([
		readComponent(value, "x"),
		readComponent(value, "y"),
		readComponent(value, "z"),
	]);
	const a = $derived(typeof value === "object" ? readComponent(value, "w") : 1);

	function write([x, y, z]: ColorComponents, w: number) {
		onchange({ x, y, z, w });
	}
</script>

<div class="nodrag nowheel flex flex-col gap-1 py-1">
	<ColorWheels
		wheelClass="min-w-0 flex-1"
		mode="rgb"
		components={rgb}
		{disabled}
		onchange={(next: ColorComponents) => {
			write(next, a);
		}}
	/>
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
