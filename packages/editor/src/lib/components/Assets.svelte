<script lang="ts">
	import type { Asset } from "$core";
	import { AlertDialog, Button, ContextMenu, Input } from "$theme";
	import FilmSlateIcon from "phosphor-svelte/lib/FilmSlateIcon";
	import ImageBrokenIcon from "phosphor-svelte/lib/ImageBrokenIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";

	import { getGraphManager } from "../graph-manager.svelte";
	import { ASSET_DRAG_TYPE, MEDIA_ACCEPT, pickFiles } from "../utils";
	import AreaHeader from "./AreaHeader.svelte";

	let { areaId }: { areaId: string } = $props();

	const graph = getGraphManager();

	/** The asset whose name is being edited, if any. */
	let renaming = $state<string | null>(null);
	let nameBuffer = $state("");
	let dropping = $state(false);
	/** A used asset whose deletion waits for confirmation. */
	let deleting = $state.raw<Asset | null>(null);

	const usages = $derived(graph.assetUsages());

	function usedBy(asset: Asset): string {
		const count = usages.get(asset.id) ?? 0;
		return count === 0
			? "Unused"
			: `Used by ${String(count)} ${count === 1 ? "node" : "nodes"}`;
	}

	function remove(asset: Asset) {
		if ((usages.get(asset.id) ?? 0) > 0) deleting = asset;
		else graph.removeAsset(asset.id);
	}

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
							title="{asset.name}: drag it into a graph to add a node reading it"
							draggable="true"
							ondragstart={(event: DragEvent) => {
								event.dataTransfer?.setData(ASSET_DRAG_TYPE, asset.id);
								if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
							}}
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
							<span
								class="text-muted-foreground truncate px-0.5 text-left text-[0.6875rem]"
							>
								{usedBy(asset)}
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
									remove(asset);
								}}>Delete</ContextMenu.Item
							>
						</ContextMenu.Content>
					</ContextMenu.Root>
				{/each}
			</div>
		{/if}
	</div>
</div>

<AlertDialog.Root
	open={deleting !== null}
	onOpenChange={(open: boolean) => {
		if (!open) deleting = null;
	}}
>
	<AlertDialog.Content class="sm:max-w-sm">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {deleting?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				{deleting ? usedBy(deleting) : ""}, which will read a transparent image instead.
				Undo brings it back.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>
				{#snippet child({ props })}
					<Button {...props} variant="ghost">Cancel</Button>
				{/snippet}
			</AlertDialog.Cancel>
			<AlertDialog.Action>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="destructive"
						onclick={() => {
							if (deleting) graph.removeAsset(deleting.id);
							deleting = null;
						}}>Delete</Button
					>
				{/snippet}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
