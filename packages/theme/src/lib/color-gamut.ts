import type { ColorSpace } from "$core";
import { getContext, setContext } from "svelte";

const KEY = Symbol("display gamut");

/**
 * Set the colour space the colour components below show colours in, as a
 * getter so it can change while they're shown.
 */
export function setDisplayGamut(gamut: () => ColorSpace) {
	setContext(KEY, gamut);
}

/** The colour space to show colours in: sRGB unless an ancestor set one. */
export function getDisplayGamut(): () => ColorSpace {
	return getContext<(() => ColorSpace) | undefined>(KEY) ?? (() => "srgb");
}
