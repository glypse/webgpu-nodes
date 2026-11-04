import {
	type ColorSpace,
	DISPLAY_P3_FIELD,
	PLAN_TARGET,
	type RenderPlan,
	type SamplerAddress,
	type SamplerFilter,
	type ShaderProgram,
	type UniformValue,
} from "$core";

import { type FrameTiming, GpuTimer } from "./gpu-timer";
import { MediaLibrary, type TextureOf } from "./media";
import { Presenter } from "./present";
import { packBlock } from "./uniforms";

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
const LINEAR_FORMAT: GPUTextureFormat = "rgba16float";
const READBACK_FORMAT: GPUTextureFormat = "rgba8unorm";
/** Compiled pipelines kept for programs not in use, e.g. while switching between documents. */
const PIPELINE_CACHE_SIZE = 8;

const ADDRESS_MODES: Record<SamplerAddress, GPUAddressMode> = {
	clamp: "clamp-to-edge",
	repeat: "repeat",
	mirror: "mirror-repeat",
};

/** A compiled pipeline, and the layout of the resources its program reads. */
type Pipeline = { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout };

/** A compiled program with its own uniform buffers: one pass of a `CompiledPlan`. */
export class CompiledProgram {
	private frameData: ArrayBuffer;
	private frameBuffer: GPUBuffer;
	private uniformBuffer: GPUBuffer;
	private bindGroup: GPUBindGroup | undefined;
	/** The textures `bindGroup` binds, in the program's order. */
	private bound: GPUTexture[] = [];

	constructor(
		private device: GPUDevice,
		readonly program: ShaderProgram,
		readonly pipeline: GPURenderPipeline,
		private layout: GPUBindGroupLayout,
		private empty: GPUTexture,
		private samplers: readonly GPUSampler[],
	) {
		this.frameData = new ArrayBuffer(program.frame.size);
		this.frameBuffer = device.createBuffer({
			size: program.frame.size,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.uniformBuffer = device.createBuffer({
			size: program.uniforms.size,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
	}

	/** The bind group reading `textureOf`'s textures, made anew when they change. */
	private bindGroupOf(textureOf: TextureOf): GPUBindGroup {
		const textures = this.program.textures.map((t) => textureOf(t.source));
		if (this.bindGroup && textures.every((t, i) => t === this.bound[i])) return this.bindGroup;
		this.bound = textures;
		this.bindGroup = this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{ binding: this.program.frame.binding, resource: { buffer: this.frameBuffer } },
				{
					binding: this.program.uniforms.binding,
					resource: { buffer: this.uniformBuffer },
				},
				...this.program.textures.map((t, i) => ({
					binding: t.binding,
					resource: (textures[i] ?? this.empty).createView(),
				})),
				...this.program.samplers.map((s, i) => ({
					binding: s.binding,
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- one per program sampler
					resource: this.samplers[i]!,
				})),
			],
		});
		return this.bindGroup;
	}

	setUniforms(values: Readonly<Record<string, UniformValue>>) {
		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			packBlock(this.program.uniforms, values),
		);
	}

	/**
	 * Encode a pass drawing into `target` (a linear texture), for a frame
	 * presented in `colorSpace`, reading `textureOf`'s textures.
	 */
	encode(
		encoder: GPUCommandEncoder,
		target: GPUTexture,
		frame: FrameInputs,
		colorSpace: ColorSpace,
		textureOf: TextureOf,
		timestampWrites?: GPURenderPassTimestampWrites,
	) {
		packBlock(
			this.program.frame,
			{
				...frame,
				resolution: [target.width, target.height],
				[DISPLAY_P3_FIELD]: colorSpace === "display-p3" ? 1 : 0,
			},
			this.frameData,
		);
		this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameData);
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }],
			...(timestampWrites ? { timestampWrites } : {}),
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, this.bindGroupOf(textureOf));
		pass.draw(3);
		pass.end();
	}

	destroy() {
		this.frameBuffer.destroy();
		this.uniformBuffer.destroy();
	}
}

/**
 * A compiled `RenderPlan`: its passes in order, each drawing a canvas-sized
 * texture of its own (kept while the size stays the same) but the last,
 * which draws the frame.
 */
export class CompiledPlan {
	private transients = new Map<string, GPUTexture>();

	constructor(
		private device: GPUDevice,
		readonly plan: RenderPlan,
		private passes: readonly { program: CompiledProgram; writes: string }[],
		private media: MediaLibrary,
	) {}

	setUniforms(values: Readonly<Record<string, UniformValue>>) {
		for (const { program } of this.passes) program.setUniforms(values);
	}

	/** Decode the media the plan reads at `time` (see `MediaLibrary.prepare`). */
	prepare(time: number): Promise<TextureOf> {
		const sources = this.passes.flatMap(({ program }) =>
			program.program.textures.map((t) => t.source),
		);
		return this.media.prepare(sources, time);
	}

	/** A pass's own texture, the size of `like`. */
	private transient(id: string, like: GPUTexture): GPUTexture {
		const existing = this.transients.get(id);
		if (existing?.width === like.width && existing.height === like.height) return existing;
		existing?.destroy();
		const texture = this.device.createTexture({
			size: { width: like.width, height: like.height },
			format: LINEAR_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.transients.set(id, texture);
		return texture;
	}

	/**
	 * Encode the passes drawing one frame into `target` (a linear texture), to
	 * be presented in `colorSpace`. `timing` times them all as one. Media is
	 * what's decoded so far of `frame`, unless `media` gives it.
	 */
	encode(
		encoder: GPUCommandEncoder,
		target: GPUTexture,
		frame: FrameInputs,
		colorSpace: ColorSpace,
		timing?: FrameTiming,
		media: TextureOf = (source) => this.media.texture(source, frame.time),
	) {
		const textureOf: TextureOf = (source) =>
			source.kind === "render" ? this.transient(source.id, target) : media(source);
		const writes = timing?.pass();
		this.passes.forEach(({ program, writes: id }, i) => {
			const first = i === 0;
			const last = i === this.passes.length - 1;
			const timestampWrites = writes && {
				querySet: writes.querySet,
				...(first ? { beginningOfPassWriteIndex: writes.beginningOfPassWriteIndex } : {}),
				...(last ? { endOfPassWriteIndex: writes.endOfPassWriteIndex } : {}),
			};
			const into = id === PLAN_TARGET ? target : this.transient(id, target);
			program.encode(
				encoder,
				into,
				frame,
				colorSpace,
				textureOf,
				first || last ? timestampWrites : undefined,
			);
		});
	}

	destroy() {
		for (const { program } of this.passes) program.destroy();
		for (const texture of this.transients.values()) texture.destroy();
		this.transients.clear();
	}
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
	private pipelines = new Map<string, Promise<Pipeline>>();
	private samplers = new Map<string, GPUSampler>();
	private linearTextures = new Map<string, GPUTexture>();

	private constructor(readonly device: GPUDevice) {
		this.presenter = new Presenter(device);
		this.timer = GpuTimer.create(device);
		this.media = new MediaLibrary(device);
	}

	private sampler(filter: SamplerFilter, address: SamplerAddress): GPUSampler {
		const key = `${filter}|${address}`;
		let sampler = this.samplers.get(key);
		if (!sampler) {
			const mode = ADDRESS_MODES[address];
			sampler = this.device.createSampler({
				magFilter: filter,
				minFilter: filter,
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
		return new Renderer(
			await adapter.requestDevice({
				requiredFeatures: timestamps ? ["timestamp-query"] : [],
			}),
		);
	}

	/** Resolves when the device is lost (e.g. a driver reset); create a new renderer then. */
	get lost(): Promise<GPUDeviceLostInfo> {
		return this.device.lost;
	}

	/** Compile a plan's programs; throws a `ProgramError` when one doesn't compile. */
	async compile(plan: RenderPlan): Promise<CompiledPlan> {
		const passes = await Promise.all(
			plan.passes.map(async (pass) => ({
				program: await this.compileProgram(pass.program),
				writes: pass.writes,
			})),
		);
		return new CompiledPlan(this.device, plan, passes, this.media);
	}

	private async compileProgram(program: ShaderProgram): Promise<CompiledProgram> {
		const key = `${program.vertexEntry}|${program.fragmentEntry}|${program.code}`;
		let pipeline = this.pipelines.get(key);
		if (pipeline) {
			// Most recently used last, so eviction drops the least recently used.
			this.pipelines.delete(key);
			this.pipelines.set(key, pipeline);
		} else {
			pipeline = this.createPipeline(program);
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
				{ binding: program.frame.binding, visibility, buffer: { type: "uniform" } },
				{ binding: program.uniforms.binding, visibility, buffer: { type: "uniform" } },
				...program.textures.map((t) => ({
					binding: t.binding,
					visibility,
					texture: { sampleType: "float" as const },
				})),
				...program.samplers.map((s) => ({
					binding: s.binding,
					visibility,
					sampler: { type: "filtering" as const },
				})),
			],
		});
	}

	private async createPipeline(program: ShaderProgram): Promise<Pipeline> {
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
					targets: [{ format: LINEAR_FORMAT }],
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
	 * Draw one frame at `size` and read its pixels back: straight-alpha RGBA,
	 * 8 bits per channel, encoded in `colorSpace`.
	 */
	async readPixels(
		plan: CompiledPlan,
		frame: FrameInputs,
		size: Size,
		colorSpace: ColorSpace,
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
			const media = await plan.prepare(frame.time);
			const encoder = this.device.createCommandEncoder();
			plan.encode(encoder, linear, frame, colorSpace, undefined, media);
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
