import { TEXTURE_FORMATS, type TextureFormat, type TextureSize } from "../passes/textures";
import {
	defineSetting,
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	settingValue,
	valueType,
	type WgslType,
	type ZoneItem,
} from "../types";

export const RENDER_TEXTURE = "render-texture";

/** The input of the scale a texture is relative to its base. */
export const RENDER_SCALE = "scale";
/** The input of the size in pixels. */
export const RENDER_PIXELS = "pixels";
/** The input of the texture a scale is relative to. */
export const RENDER_LIKE = "like";

export const RENDER_MODE_SETTING = defineSetting({
	key: "mode",
	label: "Size",
	options: [
		{ value: "scale", label: "Scale" },
		{ value: "pixels", label: "Pixels" },
	],
});

/** The format an item has unless it's given one. */
export const DEFAULT_RENDER_FORMAT: TextureFormat = "rgba16float";

const DEFAULT_ITEMS: ZoneItem[] = [
	{ id: "color", label: "Color", type: "vec4f", format: DEFAULT_RENDER_FORMAT },
];

const DEFAULT_PIXELS = 256;

export function renderTextureItems(data: NodeData): ZoneItem[] {
	return data.items ?? DEFAULT_ITEMS;
}

/** What an item's input takes: a texture item's values are colours. */
export function renderItemType(item: ZoneItem): WgslType {
	return typeof item.type === "string" ? valueType(item.type) : "vec4f";
}

export function renderItemFormat(item: ZoneItem): TextureFormat {
	return item.format ?? DEFAULT_RENDER_FORMAT;
}

/** Whether a Render Texture draws its size from pixels rather than a scale. */
export function rendersInPixels(data: NodeData): boolean {
	return settingValue(data, RENDER_MODE_SETTING) === "pixels";
}

/** The size inputs a Render Texture's scale and pixels stand for, as a size when nothing is linked. */
export function storedSize(data: NodeData, base: "canvas" | { resource: string }): TextureSize {
	const values = data.values ?? {};
	const number = (id: string, key: "x" | "y" | undefined, fallback: number): number => {
		const stored = values[id];
		const value = typeof stored === "object" ? stored[key ?? "x"] : stored;
		return typeof value === "number" ? value : fallback;
	};
	if (rendersInPixels(data)) {
		return {
			kind: "pixels",
			width: number(RENDER_PIXELS, "x", DEFAULT_PIXELS),
			height: number(RENDER_PIXELS, "y", DEFAULT_PIXELS),
		};
	}
	return { kind: "scale", scale: number(RENDER_SCALE, undefined, 1), of: base };
}

export function isRenderFormat(value: unknown): value is TextureFormat {
	return TEXTURE_FORMATS.includes(value as TextureFormat);
}

/**
 * A node drawing values or textures into textures of a chosen size and
 * format, several at once. It emits no code: its outputs are drawn by passes
 * of their own.
 */
export function buildRenderTextureDescriptor(data: NodeData): NodeDescriptor {
	const items = renderTextureItems(data);
	const size: NodeInputDef = rendersInPixels(data)
		? { id: RENDER_PIXELS, label: "pixels", types: ["vec2u"], frame: true }
		: { id: RENDER_SCALE, label: "scale", types: ["f32"], frame: true };
	return {
		type: RENDER_TEXTURE,
		label: "Render Texture",
		aliases: [
			"Render Target",
			"Framebuffer",
			"Buffer",
			"Resize",
			"Resolution",
			"Downscale",
			"Pixelate",
			"Render Pass",
			"Feedback",
		],
		category: "texture",
		staticOutputTypes: true,
		widget: { kind: "items" },
		settings: [RENDER_MODE_SETTING],
		inputs: [
			size,
			{ id: RENDER_LIKE, label: "like", types: ["texture"] },
			...items.map((item) => ({
				id: item.id,
				label: item.label,
				types: [renderItemType(item)],
			})),
		],
		outputs: items.map((item) => ({
			id: item.id,
			label: item.label,
			type: "texture" as const,
		})),
		defaultData: {
			items: structuredClone(DEFAULT_ITEMS),
			settings: { mode: "scale" },
			values: {
				[RENDER_SCALE]: 1,
				[RENDER_PIXELS]: { x: DEFAULT_PIXELS, y: DEFAULT_PIXELS },
			},
		},
		wgsl: () => [],
	};
}
