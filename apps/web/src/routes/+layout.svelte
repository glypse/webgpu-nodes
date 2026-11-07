<script lang="ts">
	import "./layout.css";
	import { ModeWatcher } from "mode-watcher";
	import { type Snippet } from "svelte";

	import favicon from "#lib/assets/favicon.svg";

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<!-- Its script would only run once the page is up, as it isn't server rendered, and the CSP has no hash for it. -->
<ModeWatcher defaultMode="dark" disableHeadScriptInjection />
{@render children()}
