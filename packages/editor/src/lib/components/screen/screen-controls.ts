import type { EditorType } from "$core";
import { createContext } from "svelte";

/** What an area's frame and header ask of the screen around them. */
export type ScreenControls = {
	/** Start a corner drag: split, join, dock, or swap with Ctrl. */
	startCornerDrag(areaId: string, event: PointerEvent): void;
	/** Split an area in two halves (`x`: side by side, `y`: one above the other). */
	split(areaId: string, axis: "x" | "y"): void;
	close(areaId: string): void;
	toggleMaximized(areaId: string): void;
	setEditorType(areaId: string, type: EditorType): void;
	readonly maximized: string | null;
	readonly areaCount: number;
};

export const [getScreenControls, setScreenControls] = createContext<ScreenControls>();
