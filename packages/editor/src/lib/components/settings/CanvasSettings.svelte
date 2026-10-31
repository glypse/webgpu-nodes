<script lang="ts">
	import { MAX_CANVAS_SIZE, type ProjectSettings } from "$core";
	import { Button, Scrubbable, ToggleGroup } from "$theme";
	import ArrowsLeftRightIcon from "phosphor-svelte/lib/ArrowsLeftRightIcon";

	import { getGraphManager } from "../../graph-manager.svelte";
	import SettingField from "./SettingField.svelte";

	const graph = getGraphManager();
	const canvas = $derived(graph.settings.canvas);

	const PRESETS = [
		{ label: "HD", width: 1280, height: 720 },
		{ label: "Full HD", width: 1920, height: 1080 },
		{ label: "4K UHD", width: 3840, height: 2160 },
		{ label: "Square", width: 1080, height: 1080 },
		{ label: "Portrait", width: 1080, height: 1350 },
		{ label: "Vertical", width: 1080, height: 1920 },
	];

	function update(patch: Partial<ProjectSettings["canvas"]>) {
		graph.updateSettings({ ...graph.settings, canvas: { ...graph.settings.canvas, ...patch } });
	}

	function gcd(a: number, b: number): number {
		return b === 0 ? a : gcd(b, a % b);
	}

	const aspect = $derived.by(() => {
		const divisor = gcd(canvas.width, canvas.height);
		const w = canvas.width / divisor;
		const h = canvas.height / divisor;
		// Ratios like 1280:853 read better as a decimal.
		return w <= 32 && h <= 32 ? `${String(w)}:${String(h)}` : (w / h).toFixed(2);
	});

	function sizeInput(key: "width" | "height") {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			const value = Math.round(parseFloat(e.currentTarget.value));
			if (Number.isFinite(value)) update({ [key]: value });
		};
	}
</script>

<SettingField
	label="Size"
	description={canvas.followPreview
		? "Frames render at the preview's size, filling it."
		: "Frames render at a fixed resolution, fitted into the preview."}
>
	<ToggleGroup.Root
		type="single"
		value={canvas.followPreview ? "preview" : "fixed"}
		onValueChange={(value: string) => {
			if (value) update({ followPreview: value === "preview" });
		}}
	>
		<ToggleGroup.Item value="fixed">Fixed size</ToggleGroup.Item>
		<ToggleGroup.Item value="preview">Follow preview</ToggleGroup.Item>
	</ToggleGroup.Root>
</SettingField>

<fieldset
	disabled={canvas.followPreview}
	class="flex flex-col gap-6 transition-opacity disabled:opacity-50"
>
	<SettingField label="Resolution" description="In pixels, {aspect}.">
		<div class="flex items-center gap-2">
			<Scrubbable
				class="w-32"
				label="Width"
				integer
				min={1}
				max={MAX_CANVAS_SIZE}
				value={canvas.width}
				readonly={canvas.followPreview}
				oninput={sizeInput("width")}
			/>
			<Button
				variant="ghost"
				size="icon-sm"
				title="Swap width and height"
				onclick={() => {
					update({ width: canvas.height, height: canvas.width });
				}}
			>
				<ArrowsLeftRightIcon />
			</Button>
			<Scrubbable
				class="w-32"
				label="Height"
				integer
				min={1}
				max={MAX_CANVAS_SIZE}
				value={canvas.height}
				readonly={canvas.followPreview}
				oninput={sizeInput("height")}
			/>
		</div>
	</SettingField>

	<SettingField label="Presets">
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{#each PRESETS as preset (preset.label)}
				{@const active = preset.width === canvas.width && preset.height === canvas.height}
				<button
					type="button"
					class={[
						"hover:bg-muted flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
						active && "border-primary bg-muted",
					]}
					onclick={() => {
						update({ width: preset.width, height: preset.height });
					}}
				>
					<span class="text-sm font-medium">{preset.label}</span>
					<span class="text-muted-foreground text-xs tabular-nums">
						{preset.width} × {preset.height}
					</span>
				</button>
			{/each}
		</div>
	</SettingField>
</fieldset>
