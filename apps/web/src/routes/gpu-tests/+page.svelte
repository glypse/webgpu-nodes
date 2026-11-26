<script lang="ts">
	import type { GraphProject } from "$core";
	import { nodeFixtures, NodeTableSchema } from "$core/testing";
	import {
		type GpuFixtureFiles,
		measureGpuFixture,
		parseGpuFixture,
		runGpuFixture,
		TestGpu,
	} from "$runtime/gpu-tests";
	import { onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";

	type Test = { name: string; run: (gpu: TestGpu) => Promise<string> };
	type Result = { state: "waiting" | "running" | "passed" | "failed"; detail: string };

	// The repo's fixtures folder, five levels up from this page.
	const FIXTURE_PATH = /fixtures\/gpu\/([^/]+)\/(.+)$/;
	const NODE_PATH = /fixtures\/nodes\/([^/]+)\.json$/;
	const DATA_FILES = new Set(["project.json", "expect.json"]);
	const projectGlob = import.meta.glob<GraphProject>(
		"../../../../../fixtures/gpu/*/project.json",
		{ eager: true, import: "default" },
	);
	const expectGlob = import.meta.glob<unknown>("../../../../../fixtures/gpu/*/expect.json", {
		eager: true,
		import: "default",
	});
	const assetGlob = import.meta.glob<string>("../../../../../fixtures/gpu/**/*", {
		eager: true,
		query: "?url",
		import: "default",
	});

	function split(path: string): { folder: string; file: string } {
		const match = FIXTURE_PATH.exec(path);
		if (!match) throw new Error(`not a fixture file: ${path}`);
		return { folder: match[1] ?? "", file: match[2] ?? "" };
	}

	const projects = new SvelteMap<string, GraphProject>();
	for (const [path, project] of Object.entries(projectGlob))
		projects.set(split(path).folder, project);
	const expects = new SvelteMap<string, unknown>();
	for (const [path, json] of Object.entries(expectGlob)) expects.set(split(path).folder, json);
	const assetUrls = Object.entries(assetGlob).flatMap(([path, url]) => {
		const { folder, file } = split(path);
		return DATA_FILES.has(file) ? [] : [{ folder, file, url }];
	});

	const nodeGlob = import.meta.glob<unknown>("../../../../../fixtures/nodes/*.json", {
		eager: true,
		import: "default",
	});

	/** Each `fixtures/nodes` table runs as one row, named after its file, which its `node` matches. */
	async function runNodeTable(gpu: TestGpu, name: string, json: unknown): Promise<string> {
		const result = await NodeTableSchema["~standard"].validate(json);
		if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("; "));
		const table = result.value;
		if (table.node !== name) {
			throw new Error(`the table is for "${table.node}", not "${name}"`);
		}
		if (table.skip !== undefined) return `skipped: ${table.skip}`;

		const fixtures = nodeFixtures(table);
		const failures: string[] = [];
		let maxError = 0;
		for (const fixture of fixtures) {
			try {
				const measured = await measureGpuFixture(gpu, {
					project: fixture.project,
					expect: fixture.gpu,
					files: new Map(),
				});
				maxError = Math.max(maxError, measured.maxError);
			} catch (error) {
				failures.push(
					`${fixture.name}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (failures.length > 0) {
			throw new Error(
				`${String(failures.length)} of ${String(fixtures.length)} failed: ${failures.join("; ")}`,
			);
		}
		const shown = String(Number(maxError.toPrecision(1)));
		return `${String(table.cases.length)} cases, ${String(table.sweeps.length)} sweeps, max error ${shown}`;
	}

	const nodeTables = Object.entries(nodeGlob)
		.map(([path, json]) => ({ name: NODE_PATH.exec(path)?.[1] ?? path, json }))
		.sort((a, b) => a.name.localeCompare(b.name));

	const loads = new SvelteMap<string, Promise<GpuFixtureFiles>>();

	/** Parsed and fetched once per fixture, when it first runs. */
	function loadFixture(folder: string): Promise<GpuFixtureFiles> {
		let load = loads.get(folder);
		if (!load) {
			load = fetchFixture(folder);
			loads.set(folder, load);
		}
		return load;
	}

	async function fetchFixture(folder: string): Promise<GpuFixtureFiles> {
		const project = projects.get(folder);
		const json = expects.get(folder);
		if (!project || json === undefined) {
			throw new Error(`fixture "${folder}" needs project.json and expect.json`);
		}
		const expect = await parseGpuFixture(json);
		const files = new SvelteMap<string, Blob>();
		await Promise.all(
			assetUrls
				.filter((asset) => asset.folder === folder)
				.map(async ({ file, url }) => {
					const response = await fetch(url);
					if (!response.ok) throw new Error(`could not fetch "${file}" of "${folder}"`);
					files.set(file, await response.blob());
				}),
		);
		return { project, expect, files };
	}

	const folders = [...projects.keys()].sort();
	const TESTS: Test[] = [
		...folders.map((folder) => ({
			name: `fixture: ${folder}`,
			run: async (gpu: TestGpu) => runGpuFixture(gpu, await loadFixture(folder)),
		})),
		...nodeTables.map(({ name, json }) => ({
			name: `node: ${name}`,
			run: (gpu: TestGpu) => runNodeTable(gpu, name, json),
		})),
	];
	const ROWS = TESTS.map((test, index) => ({ test, index }));

	let visible = $state(ROWS);
	let results = $state<Result[]>(TESTS.map(() => ({ state: "waiting", detail: "" })));
	let problem = $state("");
	const failed = $derived(results.filter((r) => r.state === "failed").length);
	const done = $derived(
		visible.every(({ index }) => {
			const state = results[index]?.state;
			return state === "passed" || state === "failed";
		}),
	);

	const COLORS = {
		waiting: "text-muted-foreground",
		running: "text-muted-foreground",
		passed: "text-foreground",
		failed: "text-destructive",
	};

	onMount(() => {
		// `page.url` has no query in dev, since the layout is prerendered.
		const only = (new URLSearchParams(location.search).get("only") ?? "").toLowerCase();
		visible = ROWS.filter(({ test }) => test.name.toLowerCase().includes(only));
		let left = false;
		const run = async () => {
			const gpu = await TestGpu.create();
			try {
				for (const { test, index } of visible) {
					if (left) return;
					results[index] = { state: "running", detail: "" };
					try {
						results[index] = { state: "passed", detail: await test.run(gpu) };
					} catch (error) {
						results[index] = {
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
			{#each visible as { test, index } (index)}
				{@const result = results[index] ?? { state: "waiting", detail: "" }}
				<tr class="border-b align-top {COLORS[result.state]}">
					<td class="py-1 pr-6">{test.name}</td>
					<td class="py-1 pr-6">{result.state}</td>
					<td class="max-w-xl py-1 wrap-anywhere tabular-nums">{result.detail}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</main>
