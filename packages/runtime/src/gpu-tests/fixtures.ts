import { type ColorSpace, generateRenderPlan, GraphModel, type GraphProject } from "$core";
import {
	type Check,
	exactNumber,
	type FixtureFrame,
	type GpuFixture,
	GpuFixtureSchema,
	type Motion,
	type Tolerance,
} from "$core/testing";

import type { Size } from "../renderer";
import { cpuReference } from "./cpu-reference";
import { type Pixels, type TestGpu } from "./harness";

export type GpuFixtureFiles = {
	project: GraphProject;
	expect: GpuFixture;
	/** By the `file` each asset names, relative to the fixture's folder. */
	files: ReadonlyMap<string, Blob>;
};

/** `fixtures/gpu/<name>/expect.json`, checked against `GpuFixtureSchema`; rejects with what's wrong. */
export async function parseGpuFixture(json: unknown): Promise<GpuFixture> {
	const result = await GpuFixtureSchema["~standard"].validate(json);
	if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("; "));
	return result.value;
}

type CheckOf<K extends Check["kind"]> = Extract<Check, { kind: K }>;

/** What a fixture's checks measured: `maxError` over its pixel and CPU checks, 0 with none. */
export type GpuFixtureResult = { summary: string; maxError: number };

type CheckResult = { summary: string; error?: number };

/**
 * Draws the fixture's frames in order with one compiled plan and one
 * simulation state, then runs its checks. Throws on the first failing check.
 */
export async function measureGpuFixture(
	gpu: TestGpu,
	fixture: GpuFixtureFiles,
): Promise<GpuFixtureResult> {
	const { project, expect, files } = fixture;
	const frameCount = expect.frames.length;
	for (const check of expect.checks) {
		if (check.frame !== undefined && check.frame >= frameCount) {
			throw new Error(`a check reads frame ${String(check.frame)} of ${String(frameCount)}`);
		}
	}
	const assets = project.assets ?? [];
	const hasCpuCheck = expect.checks.some((check) => check.kind === "cpu");
	if (hasCpuCheck && assets.length > 0) {
		throw new Error("cpu checks can't read image assets yet");
	}

	for (const asset of assets) {
		const file = files.get(asset.file);
		if (!file) throw new Error(`fixture has no file "${asset.file}" for asset "${asset.id}"`);
		gpu.addFile(asset.id, file);
	}

	const model = new GraphModel(project);
	const plan = generateRenderPlan(model);
	const compiled = await gpu.compile(plan, expect.format);
	const state = gpu.simulation();
	const index = (check: Check) => check.frame ?? frameCount - 1;
	const read = new Set(expect.checks.map(index));
	const drawn = new Map<number, Pixels>();
	const results: CheckResult[] = [];
	let timing = "";
	try {
		for (const [i, frame] of expect.frames.entries()) {
			const pixels = await gpu.drawCompiled(compiled, expect.size, frame, expect.format, {
				colorSpace: expect.colorSpace,
				state,
			});
			if (read.has(i)) drawn.set(i, pixels);
		}
		for (const check of expect.checks) {
			const i = index(check);
			const pixels = drawn.get(i);
			if (!pixels) throw new Error(`frame ${String(i)} was not kept`);
			const frame = expect.frames[i];
			if (!frame) throw new Error(`frame ${String(i)} is missing`);
			switch (check.kind) {
				case "pixels":
					results.push(checkPixels(check, pixels));
					break;
				case "cpu":
					results.push(
						await checkCpu(
							project,
							check,
							expect.size,
							expect.colorSpace,
							frame,
							pixels,
						),
					);
					break;
				case "flow":
					results.push(checkFlow(check, pixels, expect.size));
					break;
			}
		}
		if (expect.timed) {
			const ms = await gpu.frameTime(plan, expect.size);
			timing = `, ${shown(ms)} ms a frame`;
		}
	} finally {
		compiled.destroy();
		state.destroy();
	}
	const count = expect.checks.length;
	const errors = results.flatMap(({ error }) => (error === undefined ? [] : [error]));
	const summaries = results.map(({ summary }) => summary).join(", ");
	return {
		summary: `${String(count)} check${count === 1 ? "" : "s"}: ${summaries}${timing}`,
		maxError: Math.max(0, ...errors),
	};
}

/** The summary line of `measureGpuFixture`, for the fixture's own row. */
export async function runGpuFixture(gpu: TestGpu, fixture: GpuFixtureFiles): Promise<string> {
	return (await measureGpuFixture(gpu, fixture)).summary;
}

/** Compares the GPU's `actual` with the expected value, as `format.ts` defines an off value. */
function compare(
	actual: number,
	expected: number,
	tolerance: Tolerance,
): { error: number; off: boolean } {
	if (Number.isNaN(expected)) {
		return Number.isNaN(actual) ? { error: 0, off: false } : { error: Infinity, off: true };
	}
	if (Number.isNaN(actual)) return { error: Infinity, off: true };
	// A negative zero is a behaviour of its own: it's pinned, so +0 is off.
	if (Object.is(expected, -0)) return { error: 0, off: !Object.is(actual, -0) };
	if (actual === expected) return { error: 0, off: false };
	if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
		return { error: Infinity, off: true };
	}
	const diff = Math.abs(actual - expected);
	return {
		error: diff,
		off: diff > tolerance.abs && diff > tolerance.rel * Math.abs(expected),
	};
}

function component(rgba: ArrayLike<number>, channel: number): number {
	return rgba[channel] ?? NaN;
}

function shown(x: number): string {
	return x === 0 ? "0" : x.toPrecision(2);
}

function checkPixels(check: CheckOf<"pixels">, pixels: Pixels): CheckResult {
	const misses: string[] = [];
	let worst = 0;
	for (const pixel of check.pixels) {
		const got = pixels.at(pixel.x, pixel.y);
		for (const channel of [0, 1, 2, 3] as const) {
			const want = pixel.rgba[channel];
			if (want === null) continue;
			const expected = exactNumber(want);
			const { error, off } = compare(component(got, channel), expected, check.tolerance);
			worst = Math.max(worst, error);
			if (off) {
				misses.push(
					`(${String(pixel.x)}, ${String(pixel.y)}) ${"rgba"[channel] ?? ""}: ${String(got[channel])}, expected ${String(expected)}`,
				);
			}
		}
	}
	if (misses.length > 0) {
		throw new Error(`pixels: ${String(misses.length)} off, ${misses.slice(0, 5).join("; ")}`);
	}
	return { summary: `pixels max error ${shown(worst)}`, error: worst };
}

/**
 * The colour the canvas shows for a value the output node takes: vec4f as it
 * is, vec3f opaque, and narrower values widened to vec3f first (a scalar
 * splatted, a vec2 zero-filled), as the codegen converts them.
 */
async function checkCpu(
	project: GraphProject,
	check: CheckOf<"cpu">,
	size: Size,
	colorSpace: ColorSpace,
	frame: FixtureFrame,
	pixels: Pixels,
): Promise<CheckResult> {
	const { width, height } = size;
	const region = check.region ?? { x: 0, y: 0, width, height };
	const channels = check.channels ?? [0, 1, 2, 3];
	const steps = (from: number, length: number) =>
		Array.from({ length: Math.ceil(length / check.stride) }, (_, i) => from + i * check.stride);
	const xs = steps(region.x, region.width);
	const ys = steps(region.y, region.height);
	const reference = await cpuReference({
		project,
		size,
		colorSpace,
		frame,
		pixels: ys.flatMap((y) => xs.map((x) => [x, y] as const)),
	});
	let worst = 0;
	let compared = 0;
	let off = 0;
	const misses: string[] = [];
	let at = 0;
	for (const y of ys) {
		for (const x of xs) {
			const expected = reference.subarray(at, at + 4);
			at += 4;
			const got = pixels.at(x, y);
			for (const channel of channels) {
				compared++;
				const result = compare(
					component(got, channel),
					component(expected, channel),
					check.tolerance,
				);
				worst = Math.max(worst, result.error);
				if (result.off) {
					off++;
					if (misses.length < 5) {
						misses.push(
							`(${String(x)}, ${String(y)}) channel ${String(channel)}: ${String(got[channel])}, cpu ${String(expected[channel])}`,
						);
					}
				}
			}
		}
	}
	if (compared === 0) throw new Error("cpu check compared no pixels");
	if (off / compared > check.maxOff) {
		throw new Error(
			`cpu: ${String(off)} of ${String(compared)} values off, ${misses.join("; ")}`,
		);
	}
	return {
		summary: `cpu max error ${shown(worst)} (${String(off)} off)`,
		error: worst,
	};
}

/** The motion of the pixel at (x, y) in pixels, y down, at the pixel's centre. */
function motionAt(motion: Motion, x: number, y: number, { width, height }: Size): [number, number] {
	const cx = x - width / 2;
	const cy = y - height / 2;
	switch (motion.kind) {
		case "translate":
			return [motion.dx, motion.dy];
		case "zoom":
			return [cx * motion.rate, cy * motion.rate];
		case "rotate":
			return [-cy * motion.rate, cx * motion.rate];
		case "disc":
			return Math.hypot(cx, cy) < motion.radius ? motion.inside : motion.outside;
	}
}

/** The flow the drawn red and green give, against `motion`, over the pixels clear of the edges by `margin`. */
function checkFlow(check: CheckOf<"flow">, pixels: Pixels, size: Size): CheckResult {
	const { width, height } = size;
	const errors: number[] = [];
	for (let y = check.margin; y < height - check.margin; y++) {
		for (let x = check.margin; x < width - check.margin; x++) {
			const [u, v] = pixels.at(x, y);
			const [dx, dy] = motionAt(check.motion, x + 0.5, y + 0.5, size);
			const error = Math.hypot(u * width - dx, -v * height - dy);
			errors.push(Number.isFinite(error) ? error : Infinity);
		}
	}
	if (errors.length === 0) throw new Error("flow check has no pixels clear of the margin");
	const mean = errors.reduce((sum, e) => sum + e, 0) / errors.length;
	const bad = errors.filter((e) => e > 1).length / errors.length;
	if (!(mean <= check.maxMean)) {
		throw new Error(`flow: mean error ${shown(mean)} px, over ${String(check.maxMean)}`);
	}
	if (bad > check.maxOff) {
		throw new Error(
			`flow: ${shown(bad)} of pixels off by over a pixel, over ${String(check.maxOff)}`,
		);
	}
	return { summary: `flow mean error ${shown(mean)} px (${shown(bad)} off)` };
}
