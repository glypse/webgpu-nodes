import { DEFAULT_SIZE_PIXELS, NODE_SIZE_HANDLES } from "../passes/item-size";
import { canMip, TEXTURE_FORMATS, type TextureFormat } from "../passes/textures";
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
export const RENDER_SCALE = NODE_SIZE_HANDLES.scale;
/** The input of the size in pixels. */
export const RENDER_PIXELS = NODE_SIZE_HANDLES.pixels;
/** The input of the texture a scale is relative to. */
export const RENDER_LIKE = NODE_SIZE_HANDLES.like;

export const RENDER_MODE_SETTING = defineSetting({
	key: "mode",
	label: "Size",
	options: [
		{ value: "scale", label: "Scale" },
		{ value: "pixels", label: "Pixels" },
	],
});

export const RENDER_MIPS_SETTING = defineSetting({
	key: "mips",
	label: "Mips",
	options: [
		{ value: "off", label: "No mips" },
		{ value: "on", label: "Mips" },
	],
});

/** The format an item has unless it's given one. */
export const DEFAULT_RENDER_FORMAT: TextureFormat = "rgba16float";

const DEFAULT_ITEMS: ZoneItem[] = [
	{ id: "color", label: "Color", type: "vec4f", format: DEFAULT_RENDER_FORMAT },
];

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

/** Whether a Render Texture keeps all the mip levels of its textures. */
export function rendersMips(data: NodeData): boolean {
	return settingValue(data, RENDER_MIPS_SETTING) === "on";
}

/** Why a Render Texture can't have the mips it asks for, if it can't. */
export function mipsProblem(data: NodeData): string | undefined {
	if (!rendersMips(data)) return undefined;
	const item = renderTextureItems(data).find((i) => !canMip(renderItemFormat(i)));
	return item && `"${item.label}" is kept in integers, which can't be averaged into mip levels.`;
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
		settings: [RENDER_MODE_SETTING, RENDER_MIPS_SETTING],
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
			settings: { mode: "scale", mips: "off" },
			values: {
				[RENDER_SCALE]: 1,
				[RENDER_PIXELS]: { x: DEFAULT_SIZE_PIXELS, y: DEFAULT_SIZE_PIXELS },
			},
		},
		wgsl: () => [],
	};
}
