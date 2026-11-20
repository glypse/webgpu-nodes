import {
	convertVar,
	isTexture,
	makeType,
	type SocketType,
	typeComponents,
	typeKind,
	type WgslType,
	type ZoneItem,
} from "../types";
import { scalarOf, texelBytes, type TextureFormat } from "./textures";

/**
 * A simulation zone as computed at `path` (the group nodes it's computed
 * through, from the root), by its input's id: each group instance keeps a
 * state of its own.
 */
export type SimulationRef = { path: readonly string[]; zone: string };

export function simulationId({ path, zone }: SimulationRef): string {
	return [...path, zone].join("/");
}

export const TEXTURE_STATE_FORMAT = "rgba16float" satisfies TextureFormat;

/** The format keeping the values of an item of `type`; a bool's as unsigned integers. */
export function stateFormat(type: SocketType): TextureFormat {
	if (isTexture(type)) return TEXTURE_STATE_FORMAT;
	const channels = ["r", "rg", "rgba", "rgba"][typeComponents(type) - 1] ?? "rgba";
	switch (typeKind(type)) {
		case "f32":
			return `${channels}32float` as TextureFormat;
		case "i32":
			return `${channels}32sint` as TextureFormat;
		default:
			return `${channels}32uint` as TextureFormat;
	}
}

/** The type of a texel of `format`, as WGSL reads and writes it. */
export function texelType(format: TextureFormat): WgslType {
	return makeType(scalarOf(format), 4);
}

/** A value of `type` as the texel of `format` keeping it. */
export function packState(expr: string, type: WgslType, format: TextureFormat): string {
	return convertVar(expr, type, texelType(format));
}

/** A texel of `format` as the value of `type` it keeps. */
export function unpackState(texel: string, type: WgslType, format: TextureFormat): string {
	return convertVar(texel, texelType(format), type);
}

/** What one pass can write, by WebGPU's default limits. */
export const MAX_COLOR_ATTACHMENTS = 8;
export const MAX_COLOR_ATTACHMENT_BYTES = 32;

/** A state item of a simulation, as computed at its instance. */
export type StateItem = {
	item: ZoneItem;
	/** Its type there: a texture item's is a texture, its values colours. */
	type: SocketType;
	format: TextureFormat;
	/** The id of the texture keeping it (see `stateTextureId`). */
	texture: string;
};

/** A simulation's state, as computed at its instance. */
export type SimulationState = {
	ref: SimulationRef;
	id: string;
	items: readonly StateItem[];
};

/** The id of the texture keeping a state item of a simulation instance. */
export function stateTextureId(simulation: SimulationRef, item: string): string {
	return `state:${simulationId(simulation)}:${item}`;
}

/** Which of a state texture's two frames is read: the previous frame's, or this one's. */
export type StateRead = "previous" | "current";

/** The id of the texture resource a state read is: one per state texture and frame. */
export function stateReadId(texture: string, read: StateRead): string {
	return `${texture}:${read}`;
}

/**
 * `items` in order, split into runs each one pass can write as colour
 * attachments: a simulation whose state takes more is computed by several.
 */
export function attachmentGroups<T extends { format: TextureFormat }>(items: readonly T[]): T[][] {
	const groups: T[][] = [];
	let current: T[] = [];
	let bytes = 0;
	for (const item of items) {
		const size = texelBytes(item.format);
		if (
			current.length > 0 &&
			(current.length === MAX_COLOR_ATTACHMENTS || bytes + size > MAX_COLOR_ATTACHMENT_BYTES)
		) {
			groups.push(current);
			current = [];
			bytes = 0;
		}
		current.push(item);
		bytes += size;
	}
	if (current.length > 0) groups.push(current);
	return groups;
}
