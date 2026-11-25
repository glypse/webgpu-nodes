import {
	type Asset,
	type GraphDocumentNode,
	GraphModel,
	type GraphProject,
	type NodeData,
	type NodeType,
	type RenderPlan,
	ROOT_ID,
	standardLibrary,
	type StandardLibraryEntry,
} from "$core";

import { type CompiledPlan, type FrameInputs, Renderer, type Size } from "../renderer";
import { SimulationState } from "../simulation";

export type TestNode = { id: string; type: NodeType; data?: NodeData; group?: string };

/** `[source, sourceHandle, target, targetHandle]` */
export type TestLink = [string, string, string, string];

const ORIGIN = { x: 0, y: 0 };

/** A graph of one document, its Output node being `out`. */
export function graph(nodes: TestNode[], links: TestLink[], assets: Asset[] = []): GraphModel {
	const project: GraphProject = {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					{ id: "out", type: "frag-output", data: {}, position: ORIGIN },
					...nodes.map(({ id, type, data = {}, group }): GraphDocumentNode => ({
						id,
						type,
						data,
						position: ORIGIN,
						...(group === undefined
							? {}
							: { group: { definitionRef: entry(group).ref, locked: true } }),
					})),
				],
				edges: links.map(([source, sourceHandle, target, targetHandle], i) => ({
					id: String(i),
					source,
					sourceHandle,
					target,
					targetHandle,
				})),
			},
		},
		assets,
	};
	return new GraphModel(project);
}

/** The latest version of a standard-library group. */
export function entry(id: string): StandardLibraryEntry {
	const found = standardLibrary.find((e) => e.id === id);
	if (!found) throw new Error(`no standard-library group "${id}"`);
	return found;
}

/** The id of a group's input or output, by its label. */
export function socket(group: string, side: "inputs" | "outputs", label: string): string {
	const found = entry(group).definition[side]?.find((h) => h.label === label);
	if (!found) throw new Error(`"${group}" has no ${side} labelled "${label}"`);
	return found.id;
}

function halfToNumber(half: number): number {
	const sign = half & 0x8000 ? -1 : 1;
	const exponent = (half >> 10) & 31;
	const mantissa = half & 1023;
	if (exponent === 0) return sign * mantissa * 2 ** -24;
	if (exponent === 31) return mantissa === 0 ? sign * Infinity : NaN;
	return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/** A frame drawn to be read: linear RGBA as the program gave it, rows down. */
export class Pixels {
	constructor(
		readonly size: Size,
		private data: Float32Array,
	) {}

	at(x: number, y: number): [number, number, number, number] {
		const i = (y * this.size.width + x) * 4;
		const component = (k: number) => this.data[i + k] ?? NaN;
		return [component(0), component(1), component(2), component(3)];
	}
}

const FIRST_FRAME: FrameInputs = { time: 0, delta: 1 / 60, frame: 0 };

/** A device to draw test graphs with, failing on anything WebGPU refuses. */
export class TestGpu {
	private files = new Map<string, Blob>();
	private errors: string[] = [];

	private constructor(readonly renderer: Renderer) {
		renderer.onError = (message) => this.errors.push(message);
		renderer.media.setFiles((id) => this.files.get(id));
	}

	static async create(): Promise<TestGpu> {
		return new TestGpu(await Renderer.create());
	}

	addFile(asset: string, file: Blob) {
		this.files.set(asset, file);
	}

	/** Throws what WebGPU refused since the last call, if anything. */
	check() {
		const [first] = this.errors.splice(0);
		if (first !== undefined) throw new Error(first);
	}

	compile(plan: RenderPlan): Promise<CompiledPlan> {
		return this.renderer.compile(plan);
	}

	async draw(plan: RenderPlan, size: Size, frame = FIRST_FRAME): Promise<Pixels> {
		const compiled = await this.compile(plan);
		try {
			return await this.drawCompiled(compiled, size, frame);
		} finally {
			compiled.destroy();
		}
	}

	async drawCompiled(compiled: CompiledPlan, size: Size, frame = FIRST_FRAME): Promise<Pixels> {
		const { device } = this.renderer;
		const { width, height } = size;
		const target = this.target(size, GPUTextureUsage.COPY_SRC);
		const state = new SimulationState(device);
		const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
		const buffer = device.createBuffer({
			size: bytesPerRow * height,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		device.pushErrorScope("validation");
		let refused: GPUError | null;
		let pixels: Pixels;
		try {
			const media = await compiled.prepare(frame, size);
			const encoder = device.createCommandEncoder();
			compiled.encode(encoder, target, frame, "srgb", state, { media });
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, size);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const halves = new Uint16Array(buffer.getMappedRange());
			const data = new Float32Array(width * height * 4);
			for (let y = 0; y < height; y++) {
				for (let i = 0; i < width * 4; i++) {
					data[y * width * 4 + i] = halfToNumber(halves[(y * bytesPerRow) / 2 + i] ?? 0);
				}
			}
			pixels = new Pixels(size, data);
		} finally {
			refused = await device.popErrorScope();
			buffer.destroy();
			target.destroy();
			state.destroy();
		}
		if (refused) throw new Error(refused.message);
		this.check();
		return pixels;
	}

	/** Milliseconds a frame of `plan` takes with the GPU kept busy, the best of a few runs. */
	async frameTime(plan: RenderPlan, size: Size, frames = 40): Promise<number> {
		const { device } = this.renderer;
		const compiled = await this.compile(plan);
		const target = this.target(size, 0);
		const state = new SimulationState(device);
		const media = await compiled.prepare(FIRST_FRAME, size);
		const run = async () => {
			const start = performance.now();
			for (let i = 0; i < frames; i++) {
				const encoder = device.createCommandEncoder();
				const frame = { time: i / 60, delta: 1 / 60, frame: i };
				compiled.encode(encoder, target, frame, "srgb", state, { media });
				device.queue.submit([encoder.finish()]);
				// A short queue keeps the GPU clocked up without piling frames up.
				if (i % 3 === 2) await device.queue.onSubmittedWorkDone();
			}
			await device.queue.onSubmittedWorkDone();
			return (performance.now() - start) / frames;
		};
		try {
			await run();
			return Math.min(await run(), await run(), await run());
		} finally {
			compiled.destroy();
			target.destroy();
			state.destroy();
		}
	}

	destroy() {
		this.renderer.destroy();
	}

	private target(size: Size, usage: GPUTextureUsageFlags): GPUTexture {
		return this.renderer.device.createTexture({
			size,
			format: "rgba16float",
			usage: usage | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
	}
}
