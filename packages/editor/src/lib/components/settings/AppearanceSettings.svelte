<script lang="ts">
	import { Button, Input, ToggleGroup } from "$theme";
	import DesktopIcon from "phosphor-svelte/lib/DesktopIcon";
	import MoonIcon from "phosphor-svelte/lib/MoonIcon";
	import SunIcon from "phosphor-svelte/lib/SunIcon";

	import { type Theme, getPreferences } from "../../preferences.svelte";
	import SettingField from "./SettingField.svelte";

	const preferences = getPreferences();

	const THEMES: { value: Theme; label: string; icon: typeof SunIcon }[] = [
		{ value: "light", label: "Light", icon: SunIcon },
		{ value: "dark", label: "Dark", icon: MoonIcon },
		{ value: "system", label: "System", icon: DesktopIcon },
	];

	let font = $state(preferences.font);
</script>

<SettingField label="Theme">
	<ToggleGroup.Root
		type="single"
		variant="outline"
		value={preferences.theme}
		onValueChange={(value: string) => {
			const theme = THEMES.find((t) => t.value === value);
			if (theme) preferences.theme = theme.value;
		}}
	>
		{#each THEMES as theme (theme.value)}
			<ToggleGroup.Item value={theme.value} class="gap-1.5 px-3">
				<theme.icon />
				{theme.label}
			</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
</SettingField>

<SettingField
	label="Interface font"
	description="Any CSS font family list, e.g. “Inter, system-ui”. Leave empty for the default."
>
	<div class="flex items-center gap-2">
		<Input
			class="max-w-80"
			placeholder="Atkinson Hyperlegible Next"
			bind:value={font}
			oninput={() => {
				preferences.font = font;
			}}
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!preferences.font}
			onclick={() => {
				font = "";
				preferences.font = "";
			}}
		>
			Reset
		</Button>
	</div>
</SettingField>
