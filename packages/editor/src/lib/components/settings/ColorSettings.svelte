<script lang="ts">
	import { type ColorSpace, COLOR_SPACES } from "$core";
	import { RadioGroup } from "$theme";

	import { getGraphManager } from "../../graph-manager.svelte";

	const graph = getGraphManager();

	const OPTIONS: Record<ColorSpace, { label: string; description: string }> = {
		srgb: {
			label: "sRGB",
			description: "The standard gamut, shown alike on every display.",
		},
		"display-p3": {
			label: "Display P3",
			description:
				"A wider gamut: colours past sRGB's (linear values outside 0–1) stay saturated on displays that support it.",
		},
	};
</script>

<RadioGroup.Root
	value={graph.settings.colorSpace}
	onValueChange={(value: string) => {
		const colorSpace = COLOR_SPACES.find((c) => c === value);
		if (colorSpace) graph.updateSettings({ ...graph.settings, colorSpace });
	}}
	class="grid w-full gap-2"
>
	{#each COLOR_SPACES as colorSpace (colorSpace)}
		{@const option = OPTIONS[colorSpace]}
		<label
			class="hover:bg-muted has-data-checked:border-primary has-data-checked:bg-muted flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
		>
			<RadioGroup.Item value={colorSpace} class="mt-0.5" />
			<span class="flex flex-col gap-0.5">
				<span class="text-sm font-medium">{option.label}</span>
				<span class="text-muted-foreground text-xs">{option.description}</span>
			</span>
		</label>
	{/each}
</RadioGroup.Root>
