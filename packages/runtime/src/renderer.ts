import type { ShaderProgram, UniformValue } from "$core";
import type { ColorSpace } from "$core";

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

/** A compiled program with its own uniform buffers. */
export class CompiledProgram {
	private frameData: ArrayBuffer;
	private frameBuffer: GPUBuffer;
	private uniformBuffer: GPUBuffer;
	private bindGroup: GPUBindGroup;

	constructor(
		private device: GPUDevice,
		readonly program: ShaderProgram,
		readonly pipeline: GPURenderPipeline,
		layout: GPUBindGroupLayout,
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
		this.bindGroup = device.createBindGroup({
			layout,
			entries: [
				{ binding: program.frame.binding, resource: { buffer: this.frameBuffer } },
				{ binding: program.uniforms.binding, resource: { buffer: this.uniformBuffer } },
			],
		});
	}

	setUniforms(values: Readonly<Record<string, UniformValue>>) {
		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			packBlock(this.program.uniforms, values),
		);
	}

	/** Encode a pass drawing one frame into `target` (a linear texture). */
	encode(encoder: GPUCommandEncoder, target: GPUTexture, frame: FrameInputs) {
		packBlock(
			this.program.frame,
			{ ...frame, resolution: [target.width, target.height] },
			this.frameData,
		);
		this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameData);
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, this.bindGroup);
		pass.draw(3);
		pass.end();
	}

	destroy() {
		this.frameBuffer.destroy();
		this.uniformBuffer.destroy();
	}
}

/**
 * Owns the GPU device and draws `ShaderProgram`s. A program draws a linear
 * colour into a float texture; presenting it encodes it for a canvas or an
 * export, in the colour space asked for.
 */
export class Renderer {
	readonly presenter: Presenter;
	private layout: GPUBindGroupLayout;
	private pipelineLayout: GPUPipelineLayout;
	private pipelines = new Map<string, Promise<GPURenderPipeline>>();
	private linearTextures = new Map<string, GPUTexture>();

	private constructor(readonly device: GPUDevice) {
		this.presenter = new Presenter(device);
		const uniform = {
			visibility: GPUShaderStage.FRAGMENT,
			buffer: { type: "uniform" },
		} as const;
		// Bindings 0 and 1 are the frame and uniform blocks of every `ShaderProgram`.
		this.layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, ...uniform },
				{ binding: 1, ...uniform },
			],
		});
		this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
	}

	/** Request a device; throws when WebGPU isn't available. */
	static async create(): Promise<Renderer> {
		if (!("gpu" in navigator)) throw new Error("This browser doesn't support WebGPU.");
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) throw new Error("No WebGPU adapter is available.");
		return new Renderer(await adapter.requestDevice());
	}

	/** Resolves when the device is lost (e.g. a driver reset); create a new renderer then. */
	get lost(): Promise<GPUDeviceLostInfo> {
		return this.device.lost;
	}

	/** Compile a program; throws a `ProgramError` when it doesn't compile. */
	async compile(program: ShaderProgram): Promise<CompiledProgram> {
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
		return new CompiledProgram(this.device, program, await pipeline, this.layout);
	}

	private async createPipeline(program: ShaderProgram): Promise<GPURenderPipeline> {
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
			return await this.device.createRenderPipelineAsync({
				layout: this.pipelineLayout,
				vertex: { module, entryPoint: program.vertexEntry },
				fragment: {
					module,
					entryPoint: program.fragmentEntry,
					targets: [{ format: LINEAR_FORMAT }],
				},
			});
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
		program: CompiledProgram,
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
			const encoder = this.device.createCommandEncoder();
			program.encode(encoder, linear, frame);
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
		this.device.destroy();
	}
}
