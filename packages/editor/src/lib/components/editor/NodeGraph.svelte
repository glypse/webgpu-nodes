<script lang="ts">
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import type { Edge, Node } from "@xyflow/svelte";
	import GraphContent from "./GraphContent.svelte";
	import { hydrateScene, saveScene } from "$editor/scenes/scene";
	import type { Scene } from "$editor/scenes/scene";
	import defaultScene from "$editor/scenes/sizing_circle.json";
	import { Button } from "$editor/components/ui/button";
	import { Input } from "$editor/components/ui/input";

	function isScene(obj: unknown): obj is Scene {
		return typeof obj === "object" && obj !== null && "nodes" in obj && "edges" in obj;
	}

	let { class: className, frag = $bindable() }: { class?: string; frag?: string } = $props();

	function loadScene(scene: Scene) {
		const { nodes: ns, edges: es, nextId } = hydrateScene(scene);
		nodes = ns;
		edges = es;
		nodeIdCounter = nextId;
	}

	const initial = isScene(defaultScene)
		? hydrateScene(defaultScene)
		: hydrateScene({ nodes: [], edges: [] });
	let nodes = $state.raw<Node[]>(initial.nodes);
	let edges = $state.raw<Edge[]>(initial.edges);
	let nodeIdCounter = $state(initial.nextId);

	function handleUpload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const scene = JSON.parse(reader.result as string) as Scene;
				loadScene(scene);
			} catch (err) {
				console.error("[scene] failed to parse uploaded JSON", err);
			}
		};
		reader.readAsText(file);
		// Reset so the same file can be re-picked
		input.value = "";
	}

	function handleSave() {
		saveScene(nodes, edges);
	}
</script>

<SvelteFlowProvider>
	<GraphContent bind:nodes bind:edges bind:frag {nodeIdCounter} class={className} />
</SvelteFlowProvider>

<!-- <div class="absolute top-10 right-10">
	<button onclick={handleSave}>Save</button>
	<label>
		Upload
		<input type="file" accept=".json" onchange={handleUpload} hidden />
	</label>
</div> -->

<div class="grid grid-flow-col gap-1 absolute top-5 right-5">
	<Button size="default" onclick={handleSave} variant="outline">Save</Button>
	<Input
		class="bg-primary-foreground text-primary"
		type="file"
		accept=".json"
		onchange={handleUpload}
		placeholder="Upload"
	/>
	<!-- <Button size="default" variant="outline">Report</Button> -->
</div>
