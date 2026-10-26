<script lang="ts">
	import { MAX_FPS, type ProjectSettings } from "$core";
	import { Scrubbable, ToggleGroup } from "$theme";

	import { getGraphManager } from "../../graph-manager.svelte";
	import SettingField from "./SettingField.svelte";

	const graph = getGraphManager();
	const timing = $derived(graph.settings.timing);

	const RATES = [24, 25, 30, 50, 60, 120];

	function update(patch: Partial<ProjectSettings["timing"]>) {
		graph.updateSettings({ ...graph.settings, timing: { ...graph.settings.timing, ...patch } });
	}
</script>

<SettingField
	label="Playback"
	description={timing.realtime
		? "Every display refresh draws a frame, and time follows the clock."
		: "Frames advance at the frame rate, so each one looks the same however it's reached."}
>
	<ToggleGroup.Root
		type="single"
		variant="outline"
		value={timing.realtime ? "realtime" : "fixed"}
		onValueChange={(value: string) => {
			if (value) update({ realtime: value === "realtime" });
		}}
	>
		<ToggleGroup.Item value="realtime">Real time</ToggleGroup.Item>
		<ToggleGroup.Item value="fixed">Fixed frame rate</ToggleGroup.Item>
	</ToggleGroup.Root>
</SettingField>

<SettingField
	label="Frame rate"
	description={timing.realtime
		? "Used for exports and stepping through frames."
		: "Frames per second, for playback, exports and stepping."}
>
	<div class="flex flex-wrap items-center gap-2">
		<Scrubbable
			class="w-32"
			label="FPS"
			min={1}
			max={MAX_FPS}
			value={timing.fps}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				const value = parseFloat(e.currentTarget.value);
				if (Number.isFinite(value)) update({ fps: value });
			}}
		/>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			value={RATES.includes(timing.fps) ? String(timing.fps) : ""}
			onValueChange={(value: string) => {
				if (value) update({ fps: Number(value) });
			}}
		>
			{#each RATES as rate (rate)}
				<ToggleGroup.Item value={String(rate)} class="tabular-nums">{rate}</ToggleGroup.Item
				>
			{/each}
		</ToggleGroup.Root>
	</div>
</SettingField>
