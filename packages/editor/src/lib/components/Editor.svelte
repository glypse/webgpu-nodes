<script lang="ts">
	import type { ShaderSource } from "$core";
	import { Resizable } from "$theme";

	import { getPreview } from "../preview.svelte";
	import NodeGraph from "./NodeGraph.svelte";
	import Preview from "./Preview.svelte";
	import SettingsDialog from "./settings/SettingsDialog.svelte";
	import Timeline from "./Timeline.svelte";

	let { class: className }: { class?: string } = $props();

	const preview = getPreview();

	const DEFAULT_SHADER = `fn frag(uv: vec2f) -> vec4f {\n\treturn vec4f(0.0, 1.0, 1.0, 1.0);\n}`;

	let shader = $state<ShaderSource>({ fragment: DEFAULT_SHADER, uniforms: {} });

	$effect(() => {
		preview.setSource(shader);
	});
</script>

<Resizable.PaneGroup direction="vertical" class={className}>
	<Resizable.Pane defaultSize={92}>
		<Resizable.PaneGroup direction="horizontal">
			<Resizable.Pane defaultSize={30}>
				<Preview />
			</Resizable.Pane>
			<Resizable.Handle />
			<Resizable.Pane defaultSize={70}>
				<NodeGraph bind:shader />
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</Resizable.Pane>
	<Resizable.Handle />
	<Resizable.Pane defaultSize={8} minSize={5}>
		<Timeline />
	</Resizable.Pane>
</Resizable.PaneGroup>

<SettingsDialog />
