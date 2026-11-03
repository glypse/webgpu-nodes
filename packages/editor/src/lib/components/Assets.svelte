<script lang="ts">
	import type { Asset } from "$core";
	import { Button, ContextMenu, Input } from "$theme";
	import FilmSlateIcon from "phosphor-svelte/lib/FilmSlateIcon";
	import ImageBrokenIcon from "phosphor-svelte/lib/ImageBrokenIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import { MEDIA_ACCEPT, pickFiles } from "../utils";
	import AreaHeader from "./AreaHeader.svelte";

	let { areaId }: { areaId: string } = $props();

	const graph = getGraphManager();

	/** The asset whose name is being edited, if any. */
	let renaming = $state<string | null>(null);
	let nameBuffer = $state("");
	let dropping = $state(false);

	async function importPicked() {
		await graph.importFiles(await pickFiles({ accept: MEDIA_ACCEPT, multiple: true }));
	}

	async function replace(asset: Asset) {
		const [file] = await pickFiles({ accept: `${asset.kind}/*` });
		if (file) await graph.replaceAssetFile(asset.id, file);
	}

	function startRename(asset: Asset) {
		nameBuffer = asset.name;
		renaming = asset.id;
	}

	function commitRename() {
		if (renaming) graph.renameAsset(renaming, nameBuffer);
		renaming = null;
	}

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes("Files") ?? false;
	}

	function formatDuration(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const rest = Math.floor(seconds - minutes * 60);
		return `${String(minutes)}:${String(rest).padStart(2, "0")}`;
	}

	function details(asset: Asset): string {
		const size = `${String(asset.width)} × ${String(asset.height)}`;
		return asset.kind === "video" ? `${size} · ${formatDuration(asset.duration)}` : size;
	}

	function focus(element: HTMLInputElement) {
		element.select();
	}
</script>

<div class="bg-background flex size-full flex-col">
	<AreaHeader {areaId}>
		<Button variant="ghost" size="xs" onclick={importPicked}>
			<PlusIcon />
			Import
		</Button>
	</AreaHeader>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class={[
			"min-h-0 flex-1 overflow-y-auto p-2",
			dropping && "outline-ring bg-accent/30 outline-2 -outline-offset-2",
		]}
		ondragover={(event) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			dropping = true;
		}}
		ondragleave={() => (dropping = false)}
		ondrop={(event) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			dropping = false;
			void graph.importFiles(Array.from(event.dataTransfer?.files ?? []));
		}}
	>
		{#if graph.assets.length === 0}
			<div
				class="text-muted-foreground flex size-full items-center justify-center p-4 text-center text-sm"
			>
				Drop images and videos here, or import them.
			</div>
		{:else}
			<div class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
				{#each graph.assets as asset (asset.id)}
					{@const url = graph.assetFiles.url(asset.id)}
					<ContextMenu.Root>
						<ContextMenu.Trigger
							class="hover:bg-accent/50 flex min-w-0 flex-col gap-1 rounded-md p-1"
							title={asset.name}
						>
							<div
								class="bg-muted text-muted-foreground relative flex aspect-video items-center justify-center overflow-hidden rounded"
							>
								{#if !url}
									<ImageBrokenIcon class="size-6" />
								{:else if asset.kind === "image"}
									<img src={url} alt="" class="size-full object-contain" />
								{:else}
									<video
										src={url}
										preload="metadata"
										muted
										class="size-full object-contain"
									></video>
									<FilmSlateIcon
										class="absolute right-1 bottom-1 size-3.5 text-white drop-shadow"
									/>
								{/if}
							</div>
							{#if renaming === asset.id}
								<Input
									bind:value={nameBuffer}
									class="h-6 px-1 text-xs md:text-xs"
									onblur={commitRename}
									onkeydown={(event: KeyboardEvent) => {
										if (event.key === "Enter") commitRename();
										if (event.key === "Escape") renaming = null;
									}}
									{@attach focus}
								/>
							{:else}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="truncate px-0.5 text-left text-xs"
									ondblclick={() => {
										startRename(asset);
									}}>{asset.name}</span
								>
							{/if}
							<span
								class="text-muted-foreground truncate px-0.5 text-left text-[0.6875rem]"
							>
								{url ? details(asset) : "File missing"}
							</span>
						</ContextMenu.Trigger>
						<ContextMenu.Content class="w-44">
							<ContextMenu.Item
								onSelect={() => {
									startRename(asset);
								}}>Rename</ContextMenu.Item
							>
							<ContextMenu.Item onSelect={() => replace(asset)}
								>Replace file…</ContextMenu.Item
							>
							<ContextMenu.Separator />
							<ContextMenu.Item
								variant="destructive"
								onSelect={() => {
									graph.removeAsset(asset.id);
								}}>Delete</ContextMenu.Item
							>
						</ContextMenu.Content>
					</ContextMenu.Root>
				{/each}
			</div>
		{/if}
	</div>
</div>
