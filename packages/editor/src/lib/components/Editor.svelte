<script lang="ts">
	import { generateShader, reachableShaderHash } from "$core";

	import { getDevTools } from "../dev-tools.svelte";
	import { getGraphManager } from "../graph-manager.svelte";
	import { getPreview } from "../preview.svelte";
	import GroupSheet from "./GroupSheet.svelte";
	import ScreenLayout from "./screen/ScreenLayout.svelte";
	import SettingsDialog from "./settings/SettingsDialog.svelte";
	import VideoExportDialog from "./VideoExportDialog.svelte";
	import ZoneSheet from "./ZoneSheet.svelte";

	let { class: className }: { class?: string } = $props();

	const graph = getGraphManager();
	const preview = getPreview();
	const devTools = getDevTools();

	// Undo history: record a step once the documents stop changing for a
	// moment, so a drag or a scrub becomes one step. Node/edge arrays and the
	// settings are reassigned on every change, which is what this effect tracks.
	const HISTORY_DEBOUNCE_MS = 300;
	$effect(() => {
		const tracked: unknown[] = [...graph.project.definitions.values()].map((doc) => [
			doc.nodes,
			doc.edges,
			doc.label,
			doc.locked,
		]);
		if (tracked.length === 0) return;
		tracked.push(graph.settings);
		const timer = setTimeout(() => {
			graph.recordHistory();
		}, HISTORY_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
		};
	});

	// Track the shader-relevant hash to avoid regenerating on position changes.
	// Only hash the reachable subgraph so edits to disconnected nodes or unused
	// group definitions don't trigger unnecessary shader regeneration.
	let prevHash = "";
	let prevFragment = "";

	// The values of the documents graph areas show are uniforms: editing them
	// only changes the uniforms, while the fragment (and its compiled
	// pipeline) stays the same, whichever area is used.
	const uniformScopes = $derived(
		[
			...new Set(
				graph
					.graphAreas()
					.filter((a) => !graph.isLockedAt(a.editor.path))
					.map((a) => graph.definitionRefAt(a.editor.path)),
			),
		].toSorted(),
	);

	$effect(() => {
		const hash = `${uniformScopes.join(",")}|${reachableShaderHash(graph.project)}`;
		if (hash === prevHash) return;
		prevHash = hash;
		let generated: ReturnType<typeof generateShader>;
		try {
			generated = generateShader(graph, { uniformScopes });
		} catch (error) {
			// Keep the last valid shader (e.g. the graph briefly contains a cycle).
			console.error("[shader] generation failed", error);
			return;
		}
		preview.setSource({ fragment: generated.shader, uniforms: generated.uniforms });
		if (devTools.enabled && generated.shader !== prevFragment) {
			console.groupCollapsed("[shader debug]");
			console.log("// Compiled fragment shader:\n", generated.shader);
			console.groupEnd();
		}
		prevFragment = generated.shader;
	});

	// Close the group config sheet when selection no longer contains a group node.
	$effect(() => {
		const ids = graph.selectedNodeIds;
		if (!graph.sheetOpen) return;
		// Keep the sheet open when we're inside a group (viewing its contents).
		if (graph.path.length > 0) return;
		const hasGroup = ids.some((id) => {
			const node = graph.activeDocument.nodes.find((n) => n.id === id);
			return node?.type === "node-group" && node.group;
		});
		if (!hasGroup) graph.sheetOpen = false;
	});

	// The canvas renders at a fixed size, or at the size of the preview area last used.
	const resolution = $derived(
		graph.settings.canvas.followPreview
			? preview.paneSize
			: { width: graph.settings.canvas.width, height: graph.settings.canvas.height },
	);
	$effect(() => {
		preview.configure(resolution, graph.settings.colorSpace);
	});

	const fps = $derived(graph.settings.timing.fps);
	const realtime = $derived(graph.settings.timing.realtime);
	$effect(() => {
		preview.setTiming({ fps, realtime });
	});

	/** Keys acting on the whole editor, whichever area is under the pointer. */
	function handleKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		// A focused control keeps its own keys (Space presses a button).
		if (target?.closest("input, textarea, select, button, [contenteditable], [role=menuitem]"))
			return;
		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		if (mod && (key === "z" || key === "y")) {
			event.preventDefault();
			if (key === "y" || event.shiftKey) graph.redo();
			else graph.undo();
			return;
		}
		if (mod || event.altKey) return;
		const playback: Record<string, () => void> = {
			" ": () => {
				preview.toggle();
			},
			",": () => {
				preview.step(-1);
			},
			".": () => {
				preview.step(1);
			},
			Home: () => {
				preview.seek(0);
			},
		};
		const action = playback[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class={className}>
	<ScreenLayout />
</div>

<ZoneSheet />
<GroupSheet />
<SettingsDialog />
<VideoExportDialog />
