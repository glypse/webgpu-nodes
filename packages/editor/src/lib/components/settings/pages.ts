import ArrowsOutIcon from "phosphor-svelte/lib/ArrowsOutIcon";
import PaintBrushIcon from "phosphor-svelte/lib/PaintBrushIcon";
import PaletteIcon from "phosphor-svelte/lib/PaletteIcon";
import TimerIcon from "phosphor-svelte/lib/TimerIcon";
import type { Component } from "svelte";

export type SettingsPage = "canvas" | "time" | "color" | "appearance";

export type SettingsPageInfo = {
	id: SettingsPage;
	label: string;
	description: string;
	icon: Component;
};

/** Pages by group: the project's settings, then the user's own. */
export const SETTINGS_GROUPS: readonly {
	label: string;
	hint: string;
	pages: readonly SettingsPageInfo[];
}[] = [
	{
		label: "Project",
		hint: "Saved with the project",
		pages: [
			{
				id: "canvas",
				label: "Canvas",
				description: "The resolution frames render and export at.",
				icon: ArrowsOutIcon,
			},
			{
				id: "time",
				label: "Time",
				description: "How time advances while playing and exporting.",
				icon: TimerIcon,
			},
			{
				id: "color",
				label: "Colour",
				description: "The colour space frames are shown and exported in.",
				icon: PaletteIcon,
			},
		],
	},
	{
		label: "Preferences",
		hint: "Saved in this browser",
		pages: [
			{
				id: "appearance",
				label: "Appearance",
				description: "How the editor looks.",
				icon: PaintBrushIcon,
			},
		],
	},
];
