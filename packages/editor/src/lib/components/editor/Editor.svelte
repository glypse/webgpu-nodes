<script lang="ts">
	/* import "../../styles.css"; */
	import { FragCanvas, defineMaterial } from "@motion-core/motion-gpu/svelte";
	import * as Resizable from "$editor/components/ui/resizable";
	import NodeGraph from "./NodeGraph.svelte";

	const DEFAULT_SHADER = `fn frag(uv: vec2f) -> vec4f {\n\treturn vec4f(0.0, 1.0, 1.0, 1.0);\n}`;

	let frag = $state(DEFAULT_SHADER);

	const material = $derived(
		defineMaterial({
			fragment: frag
		})
	);
</script>

<div class="w-dvw h-dvh">
	<Resizable.PaneGroup direction="horizontal" class="size-full">
		<Resizable.Pane defaultSize={50}>
			<div class="size-full notexture">
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
</div>

<style>
	.notexture {
		background: repeating-conic-gradient(fuchsia 0 25%, black 0 50%) 50% / 40px 40px;
	}
</style>
