<script lang="ts">
	import { Resizable } from "$theme";
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

	type ShaderError = {
		title: string;
		message: string;
		hint: string;
		details: string[];
		phase: string;
		sourceLine?: number;
		snippet?: { number: number; code: string; highlight: boolean }[];
	};

	let shaderError = $state<ShaderError | null>(null);

	function handleError(report: {
		title: string;
		message: string;
		hint: string;
		details: string[];
		phase: string;
		rawMessage?: string;
		source?: {
			line?: number;
			snippet?: { number: number; code: string; highlight: boolean }[];
		} | null;
	}) {
		shaderError = {
			title: report.title,
			message: report.message,
			hint: report.hint,
			details: report.details,
			phase: report.phase,
			sourceLine: report.source?.line,
			snippet: report.source?.snippet,
		};
	}

	// Clear the error whenever a new frag is generated (shader recompiled successfully).
	$effect(() => {
		void frag;
		shaderError = null;
	});
</script>

<Resizable.PaneGroup direction="horizontal" class={className}>
	<Resizable.Pane defaultSize={30}>
		<div class="notexture relative size-full">
			<FragCanvas
				{material}
				color={{ outputEncoding: "srgb", dynamicRange: "auto", canvasColorSpace: "srgb" }}
				showErrorOverlay={false}
				onError={handleError}
			></FragCanvas>
			{#if shaderError}
				<div
					class="bg-background/70 border-border absolute right-2 bottom-2 left-2 z-10 rounded-lg border p-3 shadow-lg backdrop-blur"
				>
					<div class="mb-1 flex items-center justify-between">
						<span class="text-sm font-semibold text-red-500">{shaderError.title}</span>
					</div>
					<p class="mb-1 text-xs">{shaderError.message}</p>
					{#if shaderError.hint}
						<p class="text-foreground/50 text-xs italic">{shaderError.hint}</p>
					{/if}
					{#if shaderError.snippet && shaderError.snippet.length > 0}
						{@const lines = shaderError.snippet.map((l) =>
							l.highlight ? `> ${l.code}` : `  ${l.code}`,
						)}
						<pre
							class="bg-muted/70 mt-2 max-h-32 overflow-auto rounded p-2 text-[11px] leading-tight">{lines.join(
								"\n",
							)}</pre>
					{:else if shaderError.details.length > 0}
						<pre
							class="bg-muted/50 mt-2 max-h-32 overflow-auto rounded p-2 text-[11px] leading-tight">{shaderError.details.join(
								"\n",
							)}</pre>
					{/if}
				</div>
			{/if}
		</div>
	</Resizable.Pane>
	<Resizable.Handle />
	<Resizable.Pane defaultSize={70}>
		<NodeGraph bind:frag />
	</Resizable.Pane>
</Resizable.PaneGroup>

<style>
	.notexture {
		background: repeating-conic-gradient(fuchsia 0 25%, black 0 50%) 50% / 40px 40px;
	}
</style>
