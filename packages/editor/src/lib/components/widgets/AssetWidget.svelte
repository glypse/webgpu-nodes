<script lang="ts">
	import {
		type AssetKind,
		DEFAULT_PLAYBACK,
		type NodeData,
		VIDEO_ENDS,
		type VideoEnd,
	} from "$core";
	import { Scrubbable, Select } from "$theme";
	import ImageBrokenIcon from "phosphor-svelte/lib/ImageBrokenIcon";
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";

	import { getGraphManager } from "../../graph-manager.svelte";
	import { pickFiles } from "../../utils";

	let {
		id,
		media,
		data,
		disabled,
	}: { id: string; media: AssetKind; data: NodeData; disabled: boolean } = $props();

	const graph = getGraphManager();

	/** The picker's value importing a file rather than picking an asset. */
	const IMPORT = "\0import";
	const NONE = "\0none";

	const choices = $derived(graph.assets.filter((a) => a.kind === media));
	const asset = $derived(data.asset === undefined ? undefined : graph.asset(data.asset));
	const url = $derived(asset && graph.assetFiles.url(asset.id));
	const playback = $derived(data.playback ?? DEFAULT_PLAYBACK);

	const END_LABELS: Record<VideoEnd, string> = {
		loop: "Loop",
		hold: "Hold last frame",
		transparent: "Transparent",
	};

	async function importFile() {
		const [file] = await pickFiles({ accept: `${media}/*` });
		if (!file) return;
		const [imported] = await graph.importFiles([file]);
		if (imported) graph.setNodeAsset(id, imported.id);
	}

	function pick(value: string) {
		if (value === IMPORT) void importFile();
		else graph.setNodeAsset(id, value === NONE ? undefined : value);
	}
</script>

<div class="nodrag flex flex-col gap-1 px-2 py-1">
	<div
		class="bg-muted text-muted-foreground flex aspect-video items-center justify-center overflow-hidden rounded"
	>
		{#if !asset}
			<ImageIcon class="size-6" />
		{:else if !url}
			<span class="flex flex-col items-center gap-1 text-xs" title="Its file is missing">
				<ImageBrokenIcon class="size-6" />
				File missing
			</span>
		{:else if media === "image"}
			<img src={url} alt={asset.name} class="size-full object-contain" />
		{:else}
			<video src={url} preload="metadata" muted class="size-full object-contain"></video>
		{/if}
	</div>
	<Select.Root
		type="single"
		name="{id}-asset"
		value={asset?.id ?? NONE}
		{disabled}
		onValueChange={pick}
	>
		<Select.Trigger class="w-full" title={media === "image" ? "Image file" : "Video file"}>
			<span class="truncate">{asset?.name ?? "None"}</span>
		</Select.Trigger>
		<Select.Content>
			<Select.Item value={NONE} label="None">None</Select.Item>
			{#each choices as choice (choice.id)}
				<Select.Item value={choice.id} label={choice.name}>{choice.name}</Select.Item>
			{/each}
			<Select.Item value={IMPORT} label="Import…">Import…</Select.Item>
		</Select.Content>
	</Select.Root>
	{#if media === "video"}
		<Scrubbable
			label="Start"
			value={playback.start}
			readonly={disabled}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				graph.setVideoPlayback(id, { start: parseFloat(e.currentTarget.value) || 0 });
			}}
		/>
		<Scrubbable
			label="Speed"
			value={playback.speed}
			readonly={disabled}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				graph.setVideoPlayback(id, { speed: parseFloat(e.currentTarget.value) || 0 });
			}}
		/>
		<Select.Root
			type="single"
			name="{id}-end"
			value={playback.end}
			{disabled}
			onValueChange={(value: string) => {
				const end = VIDEO_ENDS.find((e) => e === value);
				if (end) graph.setVideoPlayback(id, { end });
			}}
		>
			<Select.Trigger class="w-full" title="After its end">
				{END_LABELS[playback.end]}
			</Select.Trigger>
			<Select.Content>
				{#each VIDEO_ENDS as end (end)}
					<Select.Item value={end} label={END_LABELS[end]}>{END_LABELS[end]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
</div>
