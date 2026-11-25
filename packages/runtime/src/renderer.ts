import {
	type ColorSpace,
	evaluateFrame,
	type FrameEnv,
	type FrameProgram,
	type FrameValues,
	mipLevelCount,
	planPasses,
	type RenderPlan,
	type ResourceDecl,
	type SamplerAddress,
	type SamplerFilter,
	type ShaderProgram,
	type TextureFormat,
	type UniformValue,
} from "$core";

import { type FrameTiming, GpuTimer } from "./gpu-timer";
import { DependencyCache } from "./loops";
import { MediaLibrary, type TextureOf } from "./media";
import { MipGenerator } from "./mips";
import { PlanWalk } from "./plan-walk";
import { Presenter } from "./present";
import { CompiledProgram, encodeDraw } from "./program";
import type { SimulationState } from "./simulation";
import { TexturePool } from "./texture-pool";

/** The values a program reads per frame. */
export type FrameInputs = {
	/** Seconds since the start. */
	time: number;
	/** Seconds since the previous frame. */
	delta: number;
	/** Index of the frame since the start. */
	frame: number;
};

export type Size = { width: number; height: number };

export type ProgramDiagnostic = {
	message: string;
	/** 1-based line and column in the program's code, when known. */
	line?: number;
	column?: number;
};

/** A program that failed to compile, and why. */
export class ProgramError extends Error {
	constructor(
		readonly diagnostics: readonly ProgramDiagnostic[],
		readonly code: string,
	) {
		super(diagnostics.map((d) => d.message).join("\n"));
		this.name = "ProgramError";
	}
}

/** The format programs draw into: linear, and wide enough for colours outside sRGB. */
const LINEAR_FORMAT: TextureFormat = "rgba16float";
const READBACK_FORMAT: GPUTextureFormat = "rgba8unorm";
/** Compiled pipelines kept for programs not in use, e.g. while switching between documents. */
const PIPELINE_CACHE_SIZE = 8;
/**
 * Past this, the browser notices finished work on a slow timer (Firefox:
 * about 100 ms) unless frames keep being presented, so waiting for each frame
 * before drawing the next leaves the GPU idle most of the time.
 */
const SLOW_COMPLETION_MS = 20;
/**
 * Frames in flight where finishing is noticed late. Firefox stops the page
 * from queuing more than this itself, so it's as deep as the queue gets.
 */
const SLOW_COMPLETION_FRAMES_IN_FLIGHT = 3;
/** Samples of how late finishing is noticed: one alone depends on where the timer is. */
const COMPLETION_SAMPLES = 5;
/**
 * Frames drawn only to step simulations are waited on in batches taking about
 * this many times the time finishing takes to be noticed, so waiting is a
 * small share of drawing, and at least `MIN_SIMULATE_BATCH_MS`.
 */
const SIMULATE_BATCH_LATENCIES = 3;
const MIN_SIMULATE_BATCH_MS = 50;

const REQUESTED_LIMITS = [
	"maxTextureDimension2D",
	"maxStorageTexturesPerShaderStage",
	"maxComputeInvocationsPerWorkgroup",
	"maxComputeWorkgroupSizeX",
	"maxComputeWorkgroupSizeY",
	"maxComputeWorkgroupSizeZ",
	"maxComputeWorkgroupStorageSize",
] as const satisfies readonly (keyof GPUSupportedLimits)[];

const ADDRESS_MODES: Record<SamplerAddress, GPUAddressMode> = {
	clamp: "clamp-to-edge",
	repeat: "repeat",
	mirror: "mirror-repeat",
};

/** A compiled pipeline, and the layout of the resources its program reads. */
type Pipeline = { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout };

/**
 * A compiled `RenderPlan`: its passes in order, each drawing textures of its
 * own (kept while their size and format stay the same) or of the
 * simulations' state, but the last, which draws the frame. A loop's passes
 * are drawn once for each iteration, into textures borrowed for it.
 *
 * Encoding a plan records its draws in slots of its programs' buffers, which
 * are written when it's done, so a plan is submitted before it's encoded again.
 */
export class CompiledPlan {
	private transients = new Map<string, GPUTexture>();
	private resources: ReadonlyMap<string, ResourceDecl>;
	private frameProgram: FrameProgram;
	private dependencies: DependencyCache;
	private uniforms: Readonly<Record<string, UniformValue>>;
	private programs: Map<string, CompiledProgram>;
	private pool: TexturePool<GPUTexture>;

	constructor(
		private device: GPUDevice,
		public plan: RenderPlan,
		programs: readonly CompiledProgram[],
		private media: MediaLibrary,
		private mips: MipGenerator,
	) {
		this.resources = new Map(plan.resources.map((r) => [r.id, r]));
		this.frameProgram = plan.frame;
		this.dependencies = new DependencyCache(plan.frame);
		this.uniforms = plan.uniforms;
		this.programs = programsById(plan, programs);
		this.pool = new TexturePool((spec) =>
			device.createTexture({
				size: { width: spec.width, height: spec.height },
				format: spec.format as GPUTextureFormat,
				mipLevelCount: spec.levels,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			}),
		);
	}

	/** Whether the plan keeps state between frames, which drawing it then needs. */
	get simulates(): boolean {
		return this.plan.resources.some((r) => r.kind === "state");
	}

	setUniforms(values: Readonly<Record<string, UniformValue>>) {
		this.uniforms = values;
		for (const program of this.programs.values()) program.setUniforms(values);
	}

	/**
	 * Take what a newer plan of the same code changes: its uniforms, its loops'
	 * counts and sizes, and the frame values its programs read.
	 */
	update(plan: RenderPlan) {
		this.programs = programsById(plan, [...this.programs.values()]);
		for (const decl of planPasses(plan.passes)) {
			this.programs.get(decl.id)?.setFrameValues(decl.program.frameValues);
		}
		this.plan = plan;
		this.resources = new Map(plan.resources.map((r) => [r.id, r]));
		this.frameProgram = plan.frame;
		this.dependencies = new DependencyCache(plan.frame);
		this.setUniforms(plan.uniforms);
	}

	/**
	 * The project time a media resource shows at `frame`: the frame's, unless
	 * a video's `time` says another. `values` runs the frame program, only
	 * when one is needed.
	 */
	private mediaTime(
		id: string,
		frame: FrameInputs,
		values: () => FrameValues | undefined,
	): number {
		const resource = this.resources.get(id);
		const time = resource?.kind === "media" ? resource.time : undefined;
		if (time === undefined) return frame.time;
		return typeof time === "number" ? time : (values()?.arg(time) ?? frame.time);
	}

	/** Decode the media the plan reads at `frame` (see `MediaLibrary.prepare`). */
	prepare(frame: FrameInputs, canvas: Size): Promise<TextureOf> {
		// Media only sized by frame values has to be decoded too, to know its size.
		const sources = [...this.resources.values()].flatMap((r) =>
			r.kind === "media"
				? [
						{
							kind: "media" as const,
							id: r.id,
							asset: r.asset,
							...(r.video ? { video: r.video } : {}),
						},
					]
				: [],
		);
		let values: FrameValues | undefined;
		const evaluated = () =>
			(values ??= evaluateFrame(this.frameProgram, {
				time: frame.time,
				delta: frame.delta,
				frame: frame.frame,
				canvas,
				passSize: canvas,
				uniforms: this.uniforms,
			} satisfies FrameEnv));
		return this.media.prepare(sources, (source) => this.mediaTime(source.id, frame, evaluated));
	}

	/** A pass's own texture, of `size` and `format`, with all its mip levels if `mips`. */
	private transient(
		id: string,
		{ width, height }: Size,
		format: TextureFormat,
		mips: boolean,
	): GPUTexture {
		const levels = mips ? mipLevelCount({ width, height }) : 1;
		const existing = this.transients.get(id);
		if (
			existing?.width === width &&
			existing.height === height &&
			existing.format === format &&
			existing.mipLevelCount === levels
		) {
			return existing;
		}
		existing?.destroy();
		const texture = this.device.createTexture({
			size: { width, height },
			format,
			mipLevelCount: levels,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.transients.set(id, texture);
		return texture;
	}

	/**
	 * Encode the passes drawing one frame into `target` (a linear texture), to
	 * be presented in `colorSpace`, the simulations stepping in `state`.
	 * `timing` times them all as one. Media is what's decoded so far of
	 * `frame`, unless `media` gives it.
	 */
	encode(
		encoder: GPUCommandEncoder,
		target: GPUTexture,
		frame: FrameInputs,
		colorSpace: ColorSpace,
		state: SimulationState,
		{ timing, media }: { timing?: FrameTiming; media?: TextureOf } = {},
	) {
		const canvas: Size = { width: target.width, height: target.height };
		// A time that reads the size of media is what's being decided: it has
		// nothing to start from, so the frame's time stands in.
		let evaluatingTimes = false;
		let timeValues: FrameValues | undefined;
		const timeOf = (id: string) =>
			this.mediaTime(id, frame, () => {
				if (evaluatingTimes) return undefined;
				evaluatingTimes = true;
				try {
					return (timeValues ??= walk.evaluate(canvas));
				} finally {
					evaluatingTimes = false;
				}
			});
		const mediaOf: TextureOf =
			media ?? ((source) => this.media.texture(source, timeOf(source.id)));
		const walk = new PlanWalk({
			plan: this.plan,
			resources: this.resources,
			frameProgram: this.frameProgram,
			uniforms: this.uniforms,
			dependencies: this.dependencies,
			frame,
			colorSpace,
			target,
			maxDimension: this.device.limits.maxTextureDimension2D,
			defaultFormat: LINEAR_FORMAT,
			programOf: (decl) => {
				const program = this.programs.get(decl.id);
				if (!program) throw new Error(`The pass "${decl.id}" isn't compiled.`);
				return program;
			},
			mediaOf,
			mediaSize: (id) => {
				const resource = this.resources.get(id);
				if (resource?.kind !== "media") return undefined;
				const texture = mediaOf({
					kind: "media",
					id,
					asset: resource.asset,
					...(resource.video ? { video: resource.video } : {}),
				});
				return { width: texture.width, height: texture.height };
			},
			emptyTexture: this.media.emptyTexture,
			state,
			persistent: (id, size, format, mips) => this.transient(id, size, format, mips),
			pool: this.pool,
		});
		for (const program of this.programs.values()) program.begin();
		const drawn = walk.run();
		for (const program of this.programs.values()) program.flush();
		const writes = timing?.pass();
		drawn.forEach(({ draw, mips }, i) => {
			const first = i === 0;
			const last = i === drawn.length - 1;
			const timestampWrites = writes && {
				querySet: writes.querySet,
				...(first ? { beginningOfPassWriteIndex: writes.beginningOfPassWriteIndex } : {}),
				...(last ? { endOfPassWriteIndex: writes.endOfPassWriteIndex } : {}),
			};
			encodeDraw(encoder, draw, first || last ? timestampWrites : undefined);
			for (const texture of mips) this.mips.generate(encoder, texture);
		});
	}

	destroy() {
		for (const program of this.programs.values()) program.destroy();
		for (const texture of this.transients.values()) texture.destroy();
		this.transients.clear();
		this.pool.destroy();
	}
}

/** The compiled programs of a plan's passes, by pass id, given in the order the passes run. */
function programsById(
	plan: RenderPlan,
	programs: readonly CompiledProgram[],
): Map<string, CompiledProgram> {
	const found = new Map<string, CompiledProgram>();
	planPasses(plan.passes).forEach((decl, i) => {
		const program = programs[i];
		if (program) found.set(decl.id, program);
	});
	return found;
}

/**
 * Owns the GPU device and draws `ShaderProgram`s. A program draws a linear
 * colour into a float texture; presenting it encodes it for a canvas or an
 * export, in the colour space asked for.
 */
export class Renderer {
	readonly presenter: Presenter;
	/** Times the programs' passes, when the device can. */
	readonly timer: GpuTimer | undefined;
	/** The images and videos programs read. */
	readonly media: MediaLibrary;
	private mips: MipGenerator;
	private pipelines = new Map<string, Promise<Pipeline>>();
	private samplers = new Map<string, GPUSampler>();
	private linearTextures = new Map<string, GPUTexture>();

	/**
	 * Told what the GPU refused that nothing else was watching for, e.g. being
	 * out of memory, and media that can't be used.
	 */
	onError: (message: string) => void = () => undefined;

	/**
	 * Frames to let the GPU work on before waiting for the oldest to finish,
	 * once measured; one until then. More let a program too heavy for the
	 * display lag the page further, so it's only more than one where waiting
	 * on one stalls.
	 */
	readonly framesInFlight: Promise<number>;
	/** Milliseconds between submitting work and being told it's done, at the least. */
	private completionLatency: Promise<number>;

	private constructor(readonly device: GPUDevice) {
		device.addEventListener("uncapturederror", (event) => {
			this.onError(event.error.message);
		});
		this.presenter = new Presenter(device);
		this.timer = GpuTimer.create(device);
		this.mips = new MipGenerator(device);
		this.media = new MediaLibrary(device);
		this.media.onError = (message) => {
			this.onError(message);
		};
		this.completionLatency = completionLatency(device).catch(() => 0);
		this.framesInFlight = this.completionLatency.then((latency) =>
			latency > SLOW_COMPLETION_MS ? SLOW_COMPLETION_FRAMES_IN_FLIGHT : 1,
		);
	}

	private sampler(filter: SamplerFilter, address: SamplerAddress): GPUSampler {
		const key = `${filter}|${address}`;
		let sampler = this.samplers.get(key);
		if (!sampler) {
			const mode = ADDRESS_MODES[address];
			sampler = this.device.createSampler({
				magFilter: filter,
				minFilter: filter,
				mipmapFilter: filter,
				addressModeU: mode,
				addressModeV: mode,
			});
			this.samplers.set(key, sampler);
		}
		return sampler;
	}

	/** Request a device; throws when WebGPU isn't available. */
	static async create(): Promise<Renderer> {
		if (!("gpu" in navigator)) throw new Error("This browser doesn't support WebGPU.");
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) throw new Error("No WebGPU adapter is available.");
		const timestamps = adapter.features.has("timestamp-query");
		// Limits that sizes, storage textures and compute passes are bound by are
		// asked for as far as the adapter goes, not left at the defaults.
		const requiredLimits: Record<string, number> = {};
		for (const name of REQUESTED_LIMITS) requiredLimits[name] = adapter.limits[name];
		return new Renderer(
			await adapter.requestDevice({
				requiredFeatures: timestamps ? ["timestamp-query"] : [],
				requiredLimits,
			}),
		);
	}

	/** Resolves when the device is lost (e.g. a driver reset); create a new renderer then. */
	get lost(): Promise<GPUDeviceLostInfo> {
		return this.device.lost;
	}

	/** Compile a plan's programs; throws a `ProgramError` when one doesn't compile. */
	async compile(plan: RenderPlan): Promise<CompiledPlan> {
		const resources = new Map(plan.resources.map((r) => [r.id, r]));
		const formatOf = (id: string): GPUTextureFormat => {
			const resource = resources.get(id);
			return resource?.kind === "state" ||
				resource?.kind === "transient" ||
				resource?.kind === "loop"
				? resource.format
				: LINEAR_FORMAT;
		};
		const programs = await Promise.all(
			planPasses(plan.passes).map((decl) =>
				this.compileProgram(decl.program, decl.writes.map(formatOf)),
			),
		);
		return new CompiledPlan(this.device, plan, programs, this.media, this.mips);
	}

	/** Compile `program`, drawing into textures of `formats`. */
	private async compileProgram(
		program: ShaderProgram,
		formats: readonly GPUTextureFormat[],
	): Promise<CompiledProgram> {
		const key = `${program.vertexEntry}|${program.fragmentEntry}|${formats.join(",")}|${program.code}`;
		let pipeline = this.pipelines.get(key);
		if (pipeline) {
			// Most recently used last, so eviction drops the least recently used.
			this.pipelines.delete(key);
			this.pipelines.set(key, pipeline);
		} else {
			pipeline = this.createPipeline(program, formats);
			this.pipelines.set(key, pipeline);
			// A failed compile isn't worth keeping.
			pipeline.catch(() => this.pipelines.delete(key));
			for (const old of this.pipelines.keys()) {
				if (this.pipelines.size <= PIPELINE_CACHE_SIZE) break;
				this.pipelines.delete(old);
			}
		}
		const { pipeline: compiled, layout } = await pipeline;
		return new CompiledProgram(
			this.device,
			program,
			compiled,
			layout,
			this.media.emptyTexture,
			program.samplers.map((s) => this.sampler(s.filter, s.address)),
		);
	}

	/** The layout of what `program` reads: its frame and uniform blocks, textures and samplers. */
	private bindGroupLayout(program: ShaderProgram): GPUBindGroupLayout {
		const visibility = GPUShaderStage.FRAGMENT;
		return this.device.createBindGroupLayout({
			entries: [
				// A draw reads its own slot of these, as a pass may be drawn many times a frame.
				{
					binding: program.frame.binding,
					visibility,
					buffer: {
						type: "uniform",
						hasDynamicOffset: true,
						minBindingSize: program.frame.size,
					},
				},
				{ binding: program.uniforms.binding, visibility, buffer: { type: "uniform" } },
				{
					binding: program.frameValues.binding,
					visibility,
					buffer: {
						type: "uniform",
						hasDynamicOffset: true,
						minBindingSize: program.frameValues.size,
					},
				},
				...program.textures.map((t) => ({
					binding: t.binding,
					visibility,
					texture: { sampleType: t.sampleType },
				})),
				...program.samplers.map((s) => ({
					binding: s.binding,
					visibility,
					sampler: { type: "filtering" as const },
				})),
			],
		});
	}

	private async createPipeline(
		program: ShaderProgram,
		formats: readonly GPUTextureFormat[],
	): Promise<Pipeline> {
		const module = this.device.createShaderModule({ code: program.code });
		const info = await module.getCompilationInfo();
		const errors = info.messages.filter((m) => m.type === "error");
		if (errors.length > 0) {
			throw new ProgramError(
				errors.map((m) => ({
					message: m.message,
					...(m.lineNum > 0 ? { line: m.lineNum, column: m.linePos } : {}),
				})),
				program.code,
			);
		}
		try {
			const layout = this.bindGroupLayout(program);
			const pipeline = await this.device.createRenderPipelineAsync({
				layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
				vertex: { module, entryPoint: program.vertexEntry },
				fragment: {
					module,
					entryPoint: program.fragmentEntry,
					targets: formats.map((format) => ({ format })),
				},
			});
			return { pipeline, layout };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ProgramError([{ message }], program.code);
		}
	}

	/** A linear texture of `size` for `slot`, reused while its size stays the same. */
	linearTexture(slot: string, { width, height }: Size): GPUTexture {
		const existing = this.linearTextures.get(slot);
		if (existing?.width === width && existing.height === height) return existing;
		existing?.destroy();
		const texture = this.device.createTexture({
			size: { width, height },
			format: LINEAR_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.linearTextures.set(slot, texture);
		return texture;
	}

	releaseLinearTexture(slot: string) {
		this.linearTextures.get(slot)?.destroy();
		this.linearTextures.delete(slot);
	}

	/**
	 * Draw `frames` at `size` without reading them back, only to step the
	 * plan's simulations in `state`: for the frames before an export's first.
	 */
	async simulate(
		plan: CompiledPlan,
		frames: Iterable<FrameInputs>,
		size: Size,
		state: SimulationState,
		signal?: AbortSignal,
	) {
		const linear = this.linearTexture("simulate", size);
		const latency = await this.completionLatency;
		const target = Math.max(MIN_SIMULATE_BATCH_MS, SIMULATE_BATCH_LATENCIES * latency);
		// Batches start at a frame and double while they take less than the
		// target, halving past twice that, so the queue stays as short as it can.
		let batch = 1;
		let queued = 0;
		let start = performance.now();
		for (const frame of frames) {
			signal?.throwIfAborted();
			const media = await plan.prepare(frame, size);
			const encoder = this.device.createCommandEncoder();
			plan.encode(encoder, linear, frame, "srgb", state, { media });
			this.device.queue.submit([encoder.finish()]);
			if (++queued < batch) continue;
			await this.device.queue.onSubmittedWorkDone();
			const elapsed = performance.now() - start;
			if (elapsed < target) batch *= 2;
			else if (elapsed > target * 2) batch = Math.max(1, Math.floor(batch / 2));
			queued = 0;
			start = performance.now();
		}
		await this.device.queue.onSubmittedWorkDone();
	}

	/**
	 * Draw one frame at `size` and read its pixels back: straight-alpha RGBA,
	 * 8 bits per channel, encoded in `colorSpace`, the simulations stepping
	 * in `state`.
	 */
	async readPixels(
		plan: CompiledPlan,
		frame: FrameInputs,
		size: Size,
		colorSpace: ColorSpace,
		state: SimulationState,
	): Promise<Uint8ClampedArray<ArrayBuffer>> {
		const { width, height } = size;
		const linear = this.linearTexture("readback", size);
		const output = this.device.createTexture({
			size,
			format: READBACK_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		// Rows of a texture-to-buffer copy are padded to 256 bytes.
		const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
		const buffer = this.device.createBuffer({
			size: bytesPerRow * height,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		try {
			const media = await plan.prepare(frame, size);
			const encoder = this.device.createCommandEncoder();
			plan.encode(encoder, linear, frame, colorSpace, state, { media });
			this.presenter.encode(encoder, linear, output.createView(), {
				format: READBACK_FORMAT,
				colorSpace,
				premultiply: false,
			});
			encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, size);
			this.device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Uint8Array(buffer.getMappedRange());
			const pixels = new Uint8ClampedArray(width * height * 4);
			for (let row = 0; row < height; row++) {
				pixels.set(
					padded.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
					row * width * 4,
				);
			}
			return pixels;
		} finally {
			buffer.destroy();
			output.destroy();
		}
	}

	destroy() {
		for (const texture of this.linearTextures.values()) texture.destroy();
		this.linearTextures.clear();
		this.media.destroy();
		this.device.destroy();
	}
}

/** Median milliseconds between submitting no work and being told it's done. */
async function completionLatency(device: GPUDevice): Promise<number> {
	const samples: number[] = [];
	for (let i = 0; i < COMPLETION_SAMPLES; i++) {
		const start = performance.now();
		device.queue.submit([device.createCommandEncoder().finish()]);
		await device.queue.onSubmittedWorkDone();
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)] ?? 0;
}
