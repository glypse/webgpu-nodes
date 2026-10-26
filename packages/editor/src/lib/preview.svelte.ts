import { type ColorSpace, type ShaderSource, buildProgram } from "$core";
import {
	CanvasTarget,
	type CompiledProgram,
	type FrameInputs,
	Player,
	ProgramError,
	Renderer,
	type Size,
	type Timing,
} from "$runtime";
import { createContext, untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

import type { PreviewView } from "./preview-view.svelte";

export type PreviewError = {
	title: string;
	message: string;
	/** Lines of the program around the error. */
	snippet?: { number: number; code: string; highlight: boolean }[];
};

/** Lines of context shown around an error. */
const SNIPPET_RADIUS = 2;

function describeError(error: unknown): PreviewError {
	if (error instanceof ProgramError) {
		const [first] = error.diagnostics;
		const lines = error.code.split("\n");
		const line = first?.line;
		return {
			title: "Shader compilation failed",
			message: first?.message ?? error.message,
			...(line === undefined
				? {}
				: {
						snippet: lines
							.map((code, i) => ({ number: i + 1, code, highlight: i + 1 === line }))
							.slice(Math.max(0, line - 1 - SNIPPET_RADIUS), line + SNIPPET_RADIUS),
					}),
		};
	}
	return {
		title: "Preview unavailable",
		message: error instanceof Error ? error.message : String(error),
	};
}

/**
 * Draws the graph's shader: owns the GPU renderer (recreated if the device is
 * lost), the compiled program, the canvases of the preview areas it presents
 * to (each with its own zoom and pan), and playback.
 */
export class Preview {
	error = $state<PreviewError | null>(null);
	exportDialogOpen = $state(false);
	playing = $state(false);
	time = $state(0);
	frame = $state(0);

	readonly player: Player;

	/** Each preview area's zoom and pan, by area id. */
	private views = new SvelteMap<string, PreviewView>();
	/** The preview area last used: menus zoom it, and the canvas can follow its size. */
	activeArea = $state<string | null>(null);
	/** Each preview area's size in device pixels, by area id. */
	private paneSizes = new SvelteMap<string, Size>();

	private renderer: Renderer | undefined;
	private rendererRequest: Promise<Renderer> | undefined;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- only drawn to, never displayed
	private targets = new Map<HTMLCanvasElement, CanvasTarget | undefined>();
	private size = $state<Size>({ width: 0, height: 0 });
	private colorSpace = $state<ColorSpace>("srgb");

	private source: ShaderSource | undefined;
	private program: CompiledProgram | undefined;
	/** The code of the newest program asked for, compiled or not. */
	private programCode: string | undefined;
	private destroyed = false;

	constructor(timing: Timing = { fps: 60, realtime: true }) {
		this.player = new Player(timing, (frame) => {
			this.draw(frame);
		});
	}

	/**
	 * Show a preview area with its own zoom and pan; returns a function
	 * removing it. The area's component owns `view`, so it never outlives it.
	 */
	addArea(areaId: string, view: PreviewView): () => void {
		// Called from effects, which must not depend on what this reads.
		untrack(() => {
			view.resolution = this.size;
			this.views.set(areaId, view);
			this.activeArea ??= areaId;
		});
		return () => {
			if (this.views.get(areaId) !== view) return;
			this.views.delete(areaId);
			this.paneSizes.delete(areaId);
			if (this.activeArea === areaId)
				this.activeArea = this.views.keys().next().value ?? null;
		};
	}

	/** The active preview area's zoom and pan, if a preview area is open. */
	get view(): PreviewView | undefined {
		return this.activeArea === null ? undefined : this.views.get(this.activeArea);
	}

	/** Report a preview area's size in device pixels. */
	setPaneSize(areaId: string, size: Size) {
		this.paneSizes.set(areaId, size);
	}

	/** The active preview area's size in device pixels: what a canvas following the preview renders at. */
	get paneSize(): Size {
		return (
			(this.activeArea === null ? undefined : this.paneSizes.get(this.activeArea)) ?? {
				width: 0,
				height: 0,
			}
		);
	}

	/** Present on `canvas` from now on; returns a function detaching it. */
	attach(canvas: HTMLCanvasElement): () => void {
		this.targets.set(canvas, undefined);
		// A failure is shown as the preview's error.
		this.ensureRenderer().then(
			() => {
				this.connectCanvases();
			},
			() => undefined,
		);
		return () => {
			this.targets.get(canvas)?.destroy();
			this.targets.delete(canvas);
		};
	}

	/** Set the render resolution and colour space of the canvases. */
	configure(size: Size, colorSpace: ColorSpace) {
		this.size = size;
		for (const view of this.views.values()) view.resolution = size;
		this.colorSpace = colorSpace;
		for (const target of this.targets.values()) target?.configure(size, colorSpace);
		this.player.invalidate();
	}

	setTiming(timing: Timing) {
		this.player.setTiming(timing);
		this.syncPlayback();
	}

	/** Show a newly generated shader; uniform-only changes skip recompiling. */
	setSource(source: ShaderSource) {
		this.source = source;
		const program = buildProgram(source.fragment, source.uniforms);
		if (program.code === this.programCode) {
			this.program?.setUniforms(source.uniforms);
			this.player.invalidate();
			return;
		}
		this.programCode = program.code;
		void this.ensureRenderer()
			.then((renderer) => renderer.compile(program))
			.then(
				(compiled) => {
					if (this.programCode !== program.code || this.destroyed) {
						compiled.destroy();
						return;
					}
					this.program?.destroy();
					this.program = compiled;
					if (this.source) compiled.setUniforms(this.source.uniforms);
					this.error = null;
					this.player.invalidate();
				},
				(error: unknown) => {
					if (this.programCode !== program.code) return;
					this.error = describeError(error);
				},
			);
	}

	play() {
		this.player.play();
		this.syncPlayback();
	}

	pause() {
		this.player.pause();
		this.syncPlayback();
	}

	toggle() {
		this.player.toggle();
		this.syncPlayback();
	}

	/** Jump to `time` seconds (on the frame grid at a fixed frame rate). */
	seek(time: number) {
		this.player.seek(time);
		this.syncPlayback();
	}

	/** Pause and move by whole frames. */
	step(frames: number) {
		this.player.step(frames);
		this.syncPlayback();
	}

	/** The canvas resolution and colour space, which exports use. */
	get output(): { size: Size; colorSpace: ColorSpace } {
		return { size: this.size, colorSpace: this.colorSpace };
	}

	/**
	 * Draw `frame` and read it back as straight-alpha RGBA, 8 bits per channel,
	 * by default at the canvas resolution and in its colour space.
	 */
	async readFrame(
		frame: FrameInputs,
		size: Size = this.size,
		colorSpace: ColorSpace = this.colorSpace,
	): Promise<Uint8ClampedArray<ArrayBuffer>> {
		const renderer = await this.ensureRenderer();
		if (!this.program) throw new Error("The shader hasn't compiled yet.");
		return renderer.readPixels(this.program, frame, size, colorSpace);
	}

	/** The frame shown, as a PNG at the canvas resolution. */
	async captureFrame(): Promise<Blob> {
		const { size, colorSpace } = this.output;
		const { time, delta, frame } = this.player.clock;
		const pixels = await this.readFrame({ time, delta, frame });
		const canvas = new OffscreenCanvas(size.width, size.height);
		const context = canvas.getContext("2d", { colorSpace });
		if (!context) throw new Error("Couldn't create a 2D canvas to encode the image.");
		context.putImageData(new ImageData(pixels, size.width, size.height, { colorSpace }), 0, 0);
		return canvas.convertToBlob({ type: "image/png" });
	}

	destroy() {
		this.destroyed = true;
		this.player.destroy();
		this.program?.destroy();
		for (const target of this.targets.values()) target?.destroy();
		this.renderer?.destroy();
	}

	private ensureRenderer(): Promise<Renderer> {
		this.rendererRequest ??= Renderer.create().then(
			(renderer) => {
				this.renderer = renderer;
				void renderer.lost.then((info) => {
					this.recover(info);
				});
				return renderer;
			},
			(error: unknown) => {
				this.error = describeError(error);
				throw error;
			},
		);
		return this.rendererRequest;
	}

	/** After a device loss, start over with a new device: canvas, then program. */
	private recover(info: GPUDeviceLostInfo) {
		if (this.destroyed || info.reason === "destroyed") return;
		console.warn("[preview] GPU device lost, recreating it:", info.message);
		this.renderer = undefined;
		this.rendererRequest = undefined;
		this.program = undefined;
		this.programCode = undefined;
		for (const canvas of this.targets.keys()) this.targets.set(canvas, undefined);
		this.ensureRenderer().then(
			() => {
				this.connectCanvases();
				if (this.source) this.setSource(this.source);
			},
			() => undefined,
		);
	}

	private connectCanvases() {
		const renderer = this.renderer;
		if (!renderer) return;
		for (const [canvas, target] of this.targets) {
			if (target) continue;
			const created = new CanvasTarget(renderer, canvas);
			created.configure(this.size, this.colorSpace);
			this.targets.set(canvas, created);
		}
		this.player.invalidate();
	}

	private draw(frame: FrameInputs) {
		this.time = frame.time;
		this.frame = frame.frame;
		const program = this.program;
		if (!program) return;
		for (const target of this.targets.values()) target?.render(program, frame);
	}

	private syncPlayback() {
		this.playing = this.player.playing;
		this.time = this.player.clock.time;
		this.frame = this.player.clock.frame;
	}
}

export const [getPreview, setPreview] = createContext<Preview>();
