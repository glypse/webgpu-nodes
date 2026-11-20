import { formatWgslLiteral } from "../codegen/literals";
import { FRAGMENT_VAR } from "../codegen/program";
import { readTexture } from "../codegen/texture-read";
import { texelType } from "../passes/simulation";
import { isFilterable } from "../passes/textures";
import {
	defineNode,
	type EnumVariant,
	knownEnum,
	type SamplerAddress,
	type SamplerFilter,
} from "../types";

export const IMAGE = "image";
export const VIDEO = "video";
export const SAMPLE_TEXTURE = "sample-texture";
export const TEXTURE_SIZE = "texture-size";
export const LOAD_TEXEL = "load-texel";

/** The output of an Image or Video node giving its file's frames. */
export const MEDIA_TEXTURE = "texture";
/** Sample Texture's input taking the coordinates to sample at. */
export const SAMPLE_TEXTURE_UV = "uv";
/** Sample Texture's input taking the mip level to read. */
export const SAMPLE_TEXTURE_LEVEL = "level";
/** Texture Size's input taking the mip level it gives the size of. */
export const TEXTURE_SIZE_LEVEL = "level";

/** Node types reading a project asset (`NodeData.asset`). */
export const MEDIA_NODE_TYPES: ReadonlySet<string> = new Set([IMAGE, VIDEO]);

export const INTERPOLATIONS: readonly EnumVariant[] = [
	{ value: 0, label: "Linear" },
	{ value: 1, label: "Closest" },
];

/** What a texture reads outside of its [0, 1] coordinates, by variant value. */
export const EXTENSIONS: readonly EnumVariant[] = [
	{ value: 0, label: "Clamp" },
	{ value: 1, label: "Repeat" },
	{ value: 2, label: "Mirror" },
	{ value: 3, label: "Transparent" },
];

const FILTER_OF: Readonly<Record<number, SamplerFilter>> = {
	0: "linear",
	1: "nearest",
};
const ADDRESS_OF: Readonly<Record<number, SamplerAddress>> = {
	1: "repeat",
	2: "mirror",
};
const EXTENSION_REPEAT = 1;
const EXTENSION_MIRROR = 2;
const EXTENSION_TRANSPARENT = 3;

/** Texture coordinates (origin top-left) of a UV (origin bottom-left, y up). */
export function textureCoordinates(uv: string): string {
	return `vec2f((${uv}).x, 1.0 - (${uv}).y)`;
}

const EXTEND_FN = "texture_extend";
const EXTEND_SOURCE = `fn ${EXTEND_FN}(coords: vec2f, extension: u32) -> vec2f {
	let repeated = fract(coords);
	let mirrored = 1.0 - abs(fract(coords * 0.5) * 2.0 - 1.0);
	return select(select(coords, mirrored, extension == ${String(EXTENSION_MIRROR)}u), repeated, extension == ${String(EXTENSION_REPEAT)}u);
}`;

const OUTSIDE_FN = "texture_outside";
const OUTSIDE_SOURCE = `fn ${OUTSIDE_FN}(coords: vec2f) -> bool {
	return any(coords < vec2f(0.0)) || any(coords > vec2f(1.0));
}`;

/** A file's frames, with its size in pixels. */
export const imageNode = defineNode({
	type: IMAGE,
	label: "Image",
	aliases: ["Image Texture", "Picture", "Photo", "Bitmap", "Movie File In", "Texture Sample"],
	category: "texture",
	staticOutputTypes: true,
	inputs: [],
	outputs: [
		{ id: MEDIA_TEXTURE, label: "texture", type: "texture" },
		{ id: "size", label: "size", type: "vec2f" },
	],
	defaultData: {},
	widget: { kind: "asset", media: "image" },
	wgsl: (ctx) => [
		`let ${ctx.outputVars.size ?? ctx.varName} = vec2f(textureDimensions(${ctx.texture(MEDIA_TEXTURE)}));`,
	],
});

/** A video file's frame at the project's time, played as its node's `playback` says. */
export const videoNode = defineNode({
	type: VIDEO,
	label: "Video",
	aliases: ["Movie", "Movie File In", "Footage", "Clip", "Video Texture"],
	category: "texture",
	staticOutputTypes: true,
	inputs: [],
	outputs: [
		{ id: MEDIA_TEXTURE, label: "texture", type: "texture" },
		{ id: "size", label: "size", type: "vec2f" },
		{ id: "duration", label: "duration", type: "f32" },
	],
	defaultData: {},
	widget: { kind: "asset", media: "video" },
	wgsl: (ctx) => {
		const asset = ctx.asset();
		const duration = asset?.kind === "video" ? asset.duration : 0;
		return [
			`let ${ctx.outputVars.size ?? "size"} = vec2f(textureDimensions(${ctx.texture(MEDIA_TEXTURE)}));`,
			`let ${ctx.outputVars.duration ?? "duration"} = ${formatWgslLiteral("f32", duration)};`,
		];
	},
});

/**
 * A texture's colour at some coordinates (the pixel's by default), its
 * interpolation and extension being enum inputs so groups can pass theirs
 * on: picked while compiling they cost nothing, per pixel they cost a
 * sample per interpolation.
 */
export const sampleTextureNode = defineNode({
	type: SAMPLE_TEXTURE,
	label: "Sample Texture",
	aliases: ["Texture Sample", "Image Texture", "texture2D", "Lookup", "Texture Fetch"],
	category: "texture",
	staticOutputTypes: true,
	inputs: [
		{ id: "texture", label: "texture", types: ["texture"] },
		{ id: SAMPLE_TEXTURE_UV, label: "uv", types: ["vec2f"], fallback: true },
		{
			id: "interpolation",
			label: "interpolation",
			types: ["u32"],
			control: { kind: "enum", variants: INTERPOLATIONS },
		},
		{
			id: "extension",
			label: "extension",
			types: ["u32"],
			control: { kind: "enum", variants: EXTENSIONS },
		},
		{ id: SAMPLE_TEXTURE_LEVEL, label: "level", types: ["f32"] },
	],
	outputs: [
		{ id: "color", label: "color", type: "vec4f" },
		{ id: "alpha", label: "alpha", type: "f32" },
	],
	defaultData: { values: { interpolation: 0, extension: 0, [SAMPLE_TEXTURE_LEVEL]: 0 } },
	wgsl: (ctx) => {
		const color = ctx.outputVars.color ?? ctx.varName;
		const texture = ctx.texture("texture");
		const uv = ctx.isPresent(SAMPLE_TEXTURE_UV)
			? ctx.promoteInput(SAMPLE_TEXTURE_UV)
			: `${FRAGMENT_VAR}.uv`;
		const interpolation = knownEnum(ctx, "interpolation", INTERPOLATIONS);
		const extension = knownEnum(ctx, "extension", EXTENSIONS);
		const coords = `${color}_coords`;
		const lines = [`let ${coords} = ${textureCoordinates(uv)};`];

		// Where the texture is sampled by hardware, a known extension is the
		// sampler's addressing; otherwise the coordinates are wrapped before a
		// clamping read.
		const format = ctx.textureFormat("texture");
		const hardware = isFilterable(format);
		const wraps = extension === EXTENSION_REPEAT || extension === EXTENSION_MIRROR;
		const wrapped = extension === undefined || (!hardware && wraps);
		const address =
			extension === undefined || !hardware ? "clamp" : (ADDRESS_OF[extension] ?? "clamp");
		const sampled = wrapped
			? `${ctx.fn(EXTEND_FN, EXTEND_SOURCE)}(${coords}, ${extension === undefined ? ctx.promoteInput("extension") : `${String(extension)}u`})`
			: coords;
		const sample = (filter: SamplerFilter) =>
			readTexture(texture, format, sampled, {
				filter,
				address,
				level: ctx.promoteInput(SAMPLE_TEXTURE_LEVEL),
				sampler: ctx.sampler,
				define: ctx.fn,
			});
		const raw =
			interpolation === undefined
				? `select(${sample("linear")}, ${sample("nearest")}, ${ctx.promoteInput("interpolation")} == 1u)`
				: sample(FILTER_OF[interpolation] ?? "linear");

		const outside = `${ctx.fn(OUTSIDE_FN, OUTSIDE_SOURCE)}(${coords})`;
		const transparent =
			extension === undefined
				? `${ctx.promoteInput("extension")} == ${String(EXTENSION_TRANSPARENT)}u && ${outside}`
				: extension === EXTENSION_TRANSPARENT
					? outside
					: undefined;
		lines.push(
			transparent === undefined
				? `let ${color} = ${raw};`
				: `let ${color} = select(${raw}, vec4f(0.0), ${transparent});`,
		);
		if (ctx.outputVars.alpha) lines.push(`let ${ctx.outputVars.alpha} = ${color}.a;`);
		return lines;
	},
});

/**
 * A texture's size in pixels at a mip level, the step from one of its pixels
 * to the next in UV, and how many levels it has.
 */
export const textureSizeNode = defineNode({
	type: TEXTURE_SIZE,
	label: "Texture Size",
	aliases: ["Image Size", "Texture Dimensions", "Texel Size", "Resolution"],
	category: "texture",
	staticOutputTypes: true,
	inputs: [
		{ id: "texture", label: "texture", types: ["texture"] },
		{ id: TEXTURE_SIZE_LEVEL, label: "level", types: ["i32"], frame: true },
	],
	outputs: [
		{ id: "size", label: "size", type: "vec2f" },
		{ id: "texel", label: "texel", type: "vec2f" },
		{ id: "levels", label: "levels", type: "i32" },
	],
	defaultData: { values: { [TEXTURE_SIZE_LEVEL]: 0 } },
	wgsl: (ctx) => {
		const size = ctx.outputVars.size ?? ctx.varName;
		const texture = ctx.texture("texture");
		const levels = `i32(textureNumLevels(${texture}))`;
		const level = `clamp(${ctx.promoteInput(TEXTURE_SIZE_LEVEL)}, 0, ${levels} - 1)`;
		return [
			`let ${size} = vec2f(textureDimensions(${texture}, ${level}));`,
			`let ${ctx.outputVars.texel ?? "texel"} = 1.0 / ${size};`,
			`let ${ctx.outputVars.levels ?? "levels"} = ${levels};`,
		];
	},
});

/** What Load Texel's value can be, by the scalar its texture's texels are read as. */
const TEXEL_VALUES = ["vec4f", "vec4i", "vec4u"] as const;

/**
 * A texture's exact texel at integer coordinates (rows down, as texture
 * memory is) and mip level, both clamped into the texture: its value as
 * the type picked on the node, converted from what the texture holds.
 */
export const loadTexelNode = defineNode({
	type: LOAD_TEXEL,
	label: "Load Texel",
	aliases: ["texelFetch", "textureLoad", "Texel Fetch", "Pixel Read", "Image Load", "Read Pixel"],
	category: "texture",
	inputs: [
		{ id: "texture", label: "texture", types: ["texture"] },
		{ id: "texel", label: "texel", types: ["vec2i"] },
		{ id: "level", label: "level", types: ["i32"] },
	],
	outputs: [{ id: "value", label: "value", type: "vec4f" }],
	typeFamily: { key: LOAD_TEXEL, types: TEXEL_VALUES },
	defaultData: { values: { texel: { x: 0, y: 0 }, level: 0 } },
	wgsl: (ctx) => {
		const texture = ctx.texture("texture");
		const levels = `i32(textureNumLevels(${texture}))`;
		const level = `${ctx.varName}_level`;
		const coords = `${ctx.varName}_texel`;
		const load = `textureLoad(${texture}, ${coords}, ${level})`;
		const held = texelType(ctx.textureFormat("texture"));
		return [
			`let ${level} = clamp(${ctx.promoteInput("level")}, 0, ${levels} - 1);`,
			`let ${coords} = clamp(${ctx.promoteInput("texel")}, vec2i(0), vec2i(textureDimensions(${texture}, ${level})) - 1);`,
			`let ${ctx.varName} = ${ctx.convert(load, held, ctx.outputType)};`,
		];
	},
});
