import type { ColorSpace, GraphProject } from "$core";
import type { FixtureFrame } from "$core/testing";

import type { Size } from "../renderer";

export type CpuReferenceRequest = {
	project: GraphProject;
	size: Size;
	colorSpace: ColorSpace;
	frame: FixtureFrame;
	/** Pixel x, y, rows top first. */
	pixels: readonly (readonly [number, number])[];
};

/** Canvas RGBA per pixel of the request, in its order. */
export type CpuReferenceReply = { values: Float64Array } | { error: string };

const pool: Worker[] = [];

function worker(i: number): Worker {
	let found = pool[i];
	if (!found) {
		found = new Worker(new URL("./cpu-reference.worker.ts", import.meta.url), {
			type: "module",
		});
		pool[i] = found;
	}
	return found;
}

function ask(target: Worker, request: CpuReferenceRequest): Promise<Float64Array> {
	return new Promise((resolve, reject) => {
		const settled = new AbortController();
		const { signal } = settled;
		target.addEventListener(
			"message",
			(event: MessageEvent<CpuReferenceReply>) => {
				settled.abort();
				const reply = event.data;
				if ("error" in reply) reject(new Error(reply.error));
				else resolve(reply.values);
			},
			{ signal },
		);
		target.addEventListener(
			"error",
			(event) => {
				settled.abort();
				reject(new Error(event.message));
			},
			{ signal },
		);
		target.postMessage(request);
	});
}

/**
 * The CPU evaluator's canvas colour at each of `pixels`, computed in workers
 * so a slow graph doesn't stall the page, the pixels shared out among them.
 * Each worker takes one request at a time.
 */
export async function cpuReference(request: CpuReferenceRequest): Promise<Float64Array> {
	const { pixels } = request;
	const count = Math.max(1, Math.min(pixels.length, navigator.hardwareConcurrency - 1));
	const chunk = Math.ceil(pixels.length / count);
	const parts = await Promise.all(
		Array.from({ length: count }, (_, i) =>
			ask(worker(i), { ...request, pixels: pixels.slice(i * chunk, (i + 1) * chunk) }),
		),
	);
	const values = new Float64Array(pixels.length * 4);
	let at = 0;
	for (const part of parts) {
		values.set(part, at);
		at += part.length;
	}
	return values;
}
