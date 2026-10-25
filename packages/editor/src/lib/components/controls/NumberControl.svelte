<script lang="ts">
	import { componentKeys, readComponent, typeKind, withComponent } from "$core";
	import { Scrubbable } from "$theme";

	import type { ControlProps } from "./types";

	let {
		control,
		type,
		value,
		disabled,
		onchange,
	}: ControlProps<{
		kind: "number";
		min?: number;
		max?: number;
	}> = $props();

	const kind = $derived(typeKind(type));
</script>

<div class="*:not-first:rounded-t-none *:not-last:rounded-b-none">
	{#each componentKeys(type) as comp, i (comp)}
		<Scrubbable
			class={"node-shell__input" + (i > 0 ? "border-border border-t" : "")}
			readonly={disabled}
			integer={kind !== "f32"}
			min={kind === "u32" ? Math.max(0, control.min ?? 0) : control.min}
			max={control.max}
			value={readComponent(value, comp)}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				const next = parseFloat(e.currentTarget.value) || 0;
				onchange(withComponent(value, type, comp, next));
			}}
		/>
	{/each}
</div>
