import type { NodeData, NodeInputDef, ZoneItem } from "../types";
import type { TextureSize } from "./textures";

/** How an item's texture is sized: unset for the canvas' size. */
export type ItemSizeMode = NonNullable<ZoneItem["size"]>;

/** The inputs of the node an item is on that give its size: frame values, and a texture to scale. */
export type SizeHandles = { scale: string; pixels: string; like: string };

/** Sizes read from inputs a Render Texture has once, and zone items have each. */
export const NODE_SIZE_HANDLES: SizeHandles = { scale: "scale", pixels: "pixels", like: "like" };

export const DEFAULT_SIZE_PIXELS = 256;

/** The inputs giving the size of the item `id` of a zone's input node. */
export function itemSizeHandles(id: string): SizeHandles {
	return { scale: `scale:${id}`, pixels: `pixels:${id}`, like: `like:${id}` };
}

/** The size inputs an item has for its mode: none for the canvas' size. */
export function sizeInputs(
	handles: SizeHandles,
	mode: ItemSizeMode | undefined,
	label?: string,
): NodeInputDef[] {
	const name = (what: string) => (label === undefined ? what : `${label} ${what}`);
	switch (mode) {
		case "scale":
			return [
				{ id: handles.scale, label: name("scale"), types: ["f32"], frame: true },
				{ id: handles.like, label: name("like"), types: ["texture"] },
			];
		case "pixels":
			return [{ id: handles.pixels, label: name("pixels"), types: ["vec2u"], frame: true }];
		default:
			return [];
	}
}

/** The ids of every size input the zone items have, whatever their mode. */
export function itemSizeInputIds(items: readonly ZoneItem[]): Set<string> {
	const ids = new Set<string>();
	for (const item of items) {
		for (const input of sizeInputs(itemSizeHandles(item.id), item.size)) ids.add(input.id);
	}
	return ids;
}

/** The numbers an item's size inputs hold when nothing is linked to them. */
export function defaultSizeValues(
	handles: SizeHandles,
	mode: ItemSizeMode,
): NonNullable<NodeData["values"]> {
	return mode === "scale"
		? { [handles.scale]: 1 }
		: { [handles.pixels]: { x: DEFAULT_SIZE_PIXELS, y: DEFAULT_SIZE_PIXELS } };
}

/** The size the stored numbers of a node's size inputs give, with `base` for a scale to be relative to. */
export function storedSize(
	data: NodeData,
	handles: SizeHandles,
	mode: ItemSizeMode,
	base: "canvas" | { resource: string },
): TextureSize {
	const values = data.values ?? {};
	const number = (id: string, key: "x" | "y" | undefined, fallback: number): number => {
		const stored = values[id];
		const value = typeof stored === "object" ? stored[key ?? "x"] : stored;
		return typeof value === "number" ? value : fallback;
	};
	if (mode === "pixels") {
		return {
			kind: "pixels",
			width: number(handles.pixels, "x", DEFAULT_SIZE_PIXELS),
			height: number(handles.pixels, "y", DEFAULT_SIZE_PIXELS),
		};
	}
	return { kind: "scale", scale: number(handles.scale, undefined, 1), of: base };
}
