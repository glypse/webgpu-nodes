<script lang="ts">
	import EnumControl from "./EnumControl.svelte";
	import NumberControl from "./NumberControl.svelte";
	import ToggleControl from "./ToggleControl.svelte";
	import type { ControlProps } from "./types";

	let props: ControlProps = $props();
</script>

<!-- The last branch takes whatever kind is left: a kind without its own branch
     fails type-checking there. -->
{#if props.control.kind === "number"}
	<NumberControl {...props} control={props.control} />
{:else if props.control.kind === "toggle"}
	<ToggleControl {...props} control={props.control} />
{:else}
	<EnumControl {...props} control={props.control} />
{/if}
