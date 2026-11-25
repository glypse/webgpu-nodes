import type { Asset, RenderPlan } from "$core";

import type { Size } from "../renderer";
import type { TestGpu } from "./harness";

/** The motion of the current frame's pixel (x, y), in pixels, y down. */
export type Motion = (x: number, y: number, size: Size) => readonly [number, number];

function hash(x: number, y: number, seed: number): number {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1073741823)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const fx = ease(x - xi);
	const fy = ease(y - yi);
	const a = hash(xi, yi, seed);
	const b = hash(xi + 1, yi, seed);
	const c = hash(xi, yi + 1, seed);
	const d = hash(xi + 1, yi + 1, seed);
	return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Detail at every scale, as photographs have. */
export function natural(x: number, y: number): number {
	let value = 0.5;
	let amplitude = 0.5;
	let frequency = 1 / 160;
	for (let octave = 0; octave < 6; octave++) {
		value += amplitude * (valueNoise(x * frequency, y * frequency, octave + 1) - 0.5);
		amplitude *= 0.55;
		frequency *= 2.03;
	}
	return value;
}

/** `natural`, with large areas of one colour. */
export function withFlatAreas(x: number, y: number): number {
	return valueNoise(x / 260, y / 260, 99) > 0.55 ? 0.62 : natural(x, y);
}

export type FlowScene = {
	name: string;
	motion: Motion;
	texture?: (x: number, y: number) => number;
	/** What the current frame's brightness is multiplied by. */
	gain?: number;
	/** The amplitude of the noise of each frame, of 1. */
	noise?: number;
};

const around =
	(f: (x: number, y: number) => readonly [number, number]): Motion =>
	(x, y, { width, height }) =>
		f(x - width / 2, y - height / 2);

export const MOTIONS = {
	"0.6 px": () => [0.5, -0.3],
	"2.3 px": () => [2, 1.2],
	"9 px": () => [8, -5],
	"16 px": () => [14, 8],
	"32 px": () => [28, -16],
	zoom: around((x, y) => [x * 0.03, y * 0.03]),
	rotation: around((x, y) => [-y * 0.03, x * 0.03]),
	layers: (x, y, { width, height }) =>
		Math.hypot(x - width / 2, y - height / 2) < height / 4 ? [10, 0] : [-4, 2],
} satisfies Record<string, Motion>;

export function imageAsset(id: string, { width, height }: Size): Asset {
	return {
		kind: "image",
		id,
		name: id,
		file: `assets/images/${id}.png`,
		mime: "image/png",
		bytes: 1,
		hash: id,
		width,
		height,
	};
}

/** Random, but the same on every run. */
function randomNumbers(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The previous and current frames of `scene`, 8 bits a channel, as files of two assets. */
export async function addFrames(
	gpu: TestGpu,
	{ motion, texture = natural, gain = 1, noise = 0 }: FlowScene,
	size: Size,
	[previous, current]: readonly [string, string],
) {
	const { width, height } = size;
	const before = new Uint8ClampedArray(width * height * 4);
	const after = new Uint8ClampedArray(width * height * 4);
	const random = randomNumbers(1);
	const grain = () => noise * (random() + random() - 1);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [dx, dy] = motion(x + 0.5, y + 0.5, size);
			const a = texture(x + 0.5, y + 0.5) + grain();
			const b = texture(x + 0.5 - dx, y + 0.5 - dy) * gain + grain();
			const i = (y * width + x) * 4;
			before.fill(a * 255, i, i + 3);
			after.fill(b * 255, i, i + 3);
			before[i + 3] = after[i + 3] = 255;
		}
	}
	const file = (data: Uint8ClampedArray<ArrayBuffer>) => {
		const canvas = new OffscreenCanvas(width, height);
		canvas.getContext("2d")?.putImageData(new ImageData(data, width, height), 0, 0);
		return canvas.convertToBlob({ type: "image/png" });
	};
	gpu.addFile(previous, await file(before));
	gpu.addFile(current, await file(after));
}

export type FlowErrors = { mean: number; median: number; p95: number; max: number; bad: number };

/**
 * How far the flow `plan` draws (in UV, y up) is from `motion`, in pixels,
 * at the pixels `margin` clear of the edges: what entered the frame has no
 * match. `bad` is the share of pixels off by more than one.
 */
export async function flowErrors(
	gpu: TestGpu,
	plan: RenderPlan,
	motion: Motion,
	size: Size,
	margin: number,
): Promise<FlowErrors> {
	const { width, height } = size;
	const pixels = await gpu.draw(plan, size);
	const errors: number[] = [];
	for (let y = margin; y < height - margin; y++) {
		for (let x = margin; x < width - margin; x++) {
			const [u, v] = pixels.at(x, y);
			const [dx, dy] = motion(x + 0.5, y + 0.5, size);
			const error = Math.hypot(u * width - dx, -v * height - dy);
			errors.push(Number.isFinite(error) ? error : Infinity);
		}
	}
	errors.sort((a, b) => a - b);
	const quantile = (q: number) => errors[Math.floor((errors.length - 1) * q)] ?? NaN;
	return {
		mean: errors.reduce((sum, e) => sum + e, 0) / errors.length,
		median: quantile(0.5),
		p95: quantile(0.95),
		max: quantile(1),
		bad: errors.filter((e) => e > 1).length / errors.length,
	};
}
