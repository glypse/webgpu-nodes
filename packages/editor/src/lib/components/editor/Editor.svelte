<script lang="ts">
	import { Resizable } from "$theme/components/ui";
	import { FragCanvas, defineMaterial } from "@motion-core/motion-gpu/svelte";

	import NodeGraph from "./NodeGraph.svelte";

	let { class: className }: { class?: string } = $props();

	const DEFAULT_SHADER = `fn frag(uv: vec2f) -> vec4f {\n\treturn vec4f(0.0, 1.0, 1.0, 1.0);\n}`;

	let frag = $state(DEFAULT_SHADER);

	const material = $derived(
		defineMaterial({
			fragment: frag,
		}),
	);
</script>

<Resizable.PaneGroup direction="horizontal" class={className}>
	<Resizable.Pane defaultSize={50}>
		<div class="notexture size-full">
			<FragCanvas
				{material}
				color={{ outputEncoding: "srgb", dynamicRange: "auto", canvasColorSpace: "srgb" }}
			></FragCanvas>
		</div>
	</Resizable.Pane>
	<Resizable.Handle />
	<Resizable.Pane defaultSize={50}>
		<NodeGraph bind:frag />
	</Resizable.Pane>
</Resizable.PaneGroup>

<style>
	.notexture {
		background: repeating-conic-gradient(fuchsia 0 25%, black 0 50%) 50% / 40px 40px;
	}
</style>
