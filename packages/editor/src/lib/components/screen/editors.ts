import type { EditorType } from "$core";
import FilmStripIcon from "phosphor-svelte/lib/FilmStripIcon";
import MonitorPlayIcon from "phosphor-svelte/lib/MonitorPlayIcon";
import TreeStructureIcon from "phosphor-svelte/lib/TreeStructureIcon";
import type { Component } from "svelte";

export const EDITORS: Record<EditorType, { label: string; icon: Component<{ class?: string }> }> = {
	graph: { label: "Node graph", icon: TreeStructureIcon },
	preview: { label: "Preview", icon: MonitorPlayIcon },
	timeline: { label: "Timeline", icon: FilmStripIcon },
};
