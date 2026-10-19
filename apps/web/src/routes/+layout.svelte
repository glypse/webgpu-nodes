<script lang="ts">
	import "./layout.css";
	import { ModeWatcher } from "mode-watcher";
	import { type Snippet } from "svelte";

	import favicon from "#lib/assets/favicon.svg";

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<ModeWatcher defaultMode="dark" />
{@render children()}
