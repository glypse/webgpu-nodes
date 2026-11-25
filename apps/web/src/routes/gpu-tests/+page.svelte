<script lang="ts">
	import { GPU_TESTS, TestGpu } from "$runtime/gpu-tests";
	import { onMount } from "svelte";

	type Result = { state: "waiting" | "running" | "passed" | "failed"; detail: string };

	let results = $state<Result[]>(GPU_TESTS.map(() => ({ state: "waiting", detail: "" })));
	let problem = $state("");
	const failed = $derived(results.filter((r) => r.state === "failed").length);
	const done = $derived(results.every((r) => r.state === "passed" || r.state === "failed"));

	const COLORS = {
		waiting: "text-muted-foreground",
		running: "text-muted-foreground",
		passed: "text-foreground",
		failed: "text-destructive",
	};

	onMount(() => {
		let left = false;
		const run = async () => {
			const gpu = await TestGpu.create();
			try {
				for (const [i, test] of GPU_TESTS.entries()) {
					if (left) return;
					results[i] = { state: "running", detail: "" };
					try {
						results[i] = { state: "passed", detail: await test.run(gpu) };
					} catch (error) {
						results[i] = {
							state: "failed",
							detail: error instanceof Error ? error.message : String(error),
						};
					}
				}
			} finally {
				gpu.destroy();
			}
		};
		run().catch((error: unknown) => {
			problem = error instanceof Error ? error.message : String(error);
		});
		return () => {
			left = true;
		};
	});
</script>

<svelte:head><title>GPU tests</title></svelte:head>

<main class="flex flex-col gap-4 p-10">
	<h1 class="text-lg font-medium">
		GPU tests:
		{#if problem}
			{problem}
		{:else if done}
			{failed === 0 ? "all passed" : `${String(failed)} failed`}
		{:else}
			running…
		{/if}
	</h1>
	<table class="w-fit text-sm">
		<tbody>
			{#each GPU_TESTS as test, i (test.name)}
				{@const result = results[i] ?? { state: "waiting", detail: "" }}
				<tr class="border-b align-top {COLORS[result.state]}">
					<td class="py-1 pr-6">{test.name}</td>
					<td class="py-1 pr-6">{result.state}</td>
					<td class="max-w-xl py-1 wrap-anywhere tabular-nums">{result.detail}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</main>
