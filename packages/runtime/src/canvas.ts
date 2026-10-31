import type { ColorSpace } from "$core";

import type { CompiledProgram, FrameInputs, Renderer, Size } from "./renderer";

let nextSlot = 0;

/** Presents frames on a canvas, whose pixel size is the render resolution. */
export class CanvasTarget {
	private context: GPUCanvasContext;
	private format = navigator.gpu.getPreferredCanvasFormat();
	private colorSpace: ColorSpace | undefined;
	/** Each canvas target draws into its own linear texture. */
	private slot = `canvas-${String(nextSlot++)}`;

	constructor(
		private renderer: Renderer,
		readonly canvas: HTMLCanvasElement,
	) {
		const context = canvas.getContext("webgpu");
		if (!context) throw new Error("Couldn't create a WebGPU canvas context.");
		this.context = context;
	}

	/**
	 * Set the resolution and colour space; cheap when nothing changed.
	 * Returns whether the canvas was cleared, which either change does.
	 */
	configure({ width, height }: Size, colorSpace: ColorSpace): boolean {
		// A canvas can't present at zero size, e.g. before it's laid out.
		if (width === 0 || height === 0) return false;
		const resized = this.canvas.width !== width || this.canvas.height !== height;
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
		if (colorSpace === this.colorSpace) return resized;
		this.colorSpace = colorSpace;
		this.context.configure({
			device: this.renderer.device,
			format: this.format,
			colorSpace,
			alphaMode: "premultiplied",
		});
		return true;
	}

	render(program: CompiledProgram, frame: FrameInputs) {
		const { width, height } = this.canvas;
		if (width === 0 || height === 0 || !this.colorSpace) return;
		const linear = this.renderer.linearTexture(this.slot, { width, height });
		const encoder = this.renderer.device.createCommandEncoder();
		program.encode(encoder, linear, frame);
		this.renderer.presenter.encode(
			encoder,
			linear,
			this.context.getCurrentTexture().createView(),
			{ format: this.format, colorSpace: this.colorSpace, premultiply: true },
		);
		this.renderer.device.queue.submit([encoder.finish()]);
	}

	destroy() {
		this.context.unconfigure();
		this.renderer.releaseLinearTexture(this.slot);
	}
}
