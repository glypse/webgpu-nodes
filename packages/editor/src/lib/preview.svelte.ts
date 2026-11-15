import type { ColorSpace, RenderPlan } from "$core";
import {
	CanvasTarget,
	type CompiledPlan,
	type FrameInputs,
	type FrameRate,
	measureRefreshRate,
	type MediaFiles,
	Player,
	ProgramError,
	Renderer,
	SimulationState,
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

/** Device losses this close together have one cause: most likely, the program. */
const LOSS_WINDOW_MS = 60_000;
/** Losses in a window after which a program isn't run again, each one resetting the GPU. */
const MAX_LOSSES = 3;
/** How long the first recovery waits; each loss in a window doubles it. */
const RECOVERY_DELAY_MS = 1000;

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
	/** The rate frames are drawn at while playing, once measured. */
	frameRate = $state.raw<FrameRate | undefined>();
	/** The display's refresh rate in Hz, once measured: what real-time playback can reach. */
	refreshRate = $state<number | undefined>();

	readonly player: Player;

	/** Each preview area's zoom and pan, by area id. */
	private views = new SvelteMap<string, PreviewView>();
	/** The preview area last used: menus zoom it, and the canvas can follow its size. */
	activeArea = $state<string | null>(null);
	/** Each preview area's size in device pixels, by area id. */
	private paneSizes = new SvelteMap<string, Size>();

	private renderer: Renderer | undefined;
	private rendererRequest: Promise<Renderer> | undefined;
	/** The state the preview's simulations keep between the frames it draws. */
	private simulation: SimulationState | undefined;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- only drawn to, never displayed
	private targets = new Map<HTMLCanvasElement, CanvasTarget | undefined>();
	private size = $state<Size>({ width: 0, height: 0 });
	private colorSpace = $state<ColorSpace>("srgb");

	private source: RenderPlan | undefined;
	private program: CompiledPlan | undefined;
	/** The code and textures of the newest plan asked for, compiled or not. */
	private programCode: string | undefined;
	/** Times the device was lost lately. */
	private losses: number[] = [];
	/** The plan that kept losing the device, as `programCode`: it won't run until it changes. */
	private blockedCode: string | undefined;
	private recovery: ReturnType<typeof setTimeout> | undefined;
	private mediaFiles: MediaFiles = () => undefined;
	private destroyed = false;
	private measuringRefreshRate = false;
	/** Whether a pause came while measuring the refresh rate, which then measures again. */
	private remeasureRefreshRate = false;
	/** Times playback started, telling whether it did during a measure. */
	private playStarts = 0;

	constructor(timing: Timing = { fps: 60, realtime: true }) {
		this.player = new Player(timing, (frame) => this.draw(frame));
		this.measureRefreshRate();
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
		// A hidden or collapsed pane keeps its last size, which a canvas
		// following it couldn't render at anyway.
		if (size.width === 0 || size.height === 0) return;
		this.paneSizes.set(areaId, size);
	}

	/**
	 * The active preview area's size in device pixels: what a canvas
	 * following the preview renders at. Undefined until it's laid out.
	 */
	get paneSize(): Size | undefined {
		return this.activeArea === null ? undefined : this.paneSizes.get(this.activeArea);
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
		let cleared = false;
		for (const target of this.targets.values())
			if (target?.configure(size, colorSpace)) cleared = true;
		// A resize follows its pane's layout, after this frame's draw: drawing
		// again on the next frame would show the cleared canvas until then,
		// so for as long as the pane keeps resizing.
		if (cleared) this.player.drawNow();
		else this.player.invalidate();
	}

	setTiming(timing: Timing) {
		this.player.setTiming(timing);
		this.syncPlayback();
	}

	/** Read the files of the project's assets from `files`, and draw again with them. */
	setMediaFiles(files: MediaFiles) {
		this.mediaFiles = files;
		this.renderer?.media.setFiles(files);
		this.player.invalidate();
	}

	/** Show a newly generated plan; uniform-only changes skip recompiling. */
	setSource(source: RenderPlan) {
		this.source = source;
		// The same code may read other textures, which its bindings are made for.
		const key = source.passes
			.map((p) => [...p.writes, p.program.code, ...p.reads].join("\n"))
			.join("\n\n");
		if (key === this.blockedCode) return;
		if (this.blockedCode !== undefined) {
			this.blockedCode = undefined;
			this.losses = [];
		}
		if (key === this.programCode) {
			this.program?.setUniforms(source.uniforms);
			this.player.invalidate();
			return;
		}
		this.programCode = key;
		void this.ensureRenderer()
			.then((renderer) => renderer.compile(source))
			.then(
				(compiled) => {
					if (this.programCode !== key || this.destroyed) {
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
					if (this.programCode !== key) return;
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
	 * by default at the canvas resolution and in its colour space, its
	 * simulations stepping in `state` (the preview's by default).
	 */
	async readFrame(
		frame: FrameInputs,
		size: Size = this.size,
		colorSpace: ColorSpace = this.colorSpace,
		state?: SimulationState,
	): Promise<Uint8ClampedArray<ArrayBuffer>> {
		const renderer = await this.ensureRenderer();
		if (!this.program) throw new Error("The shader hasn't compiled yet.");
		const simulation = state ?? this.simulation ?? new SimulationState(renderer.device);
		this.simulation ??= simulation;
		return renderer.readPixels(this.program, frame, size, colorSpace, simulation);
	}

	/** Whether the shader keeps state between frames, which a frame then depends on. */
	get simulates(): boolean {
		return this.program?.simulates ?? false;
	}

	/**
	 * A simulation state of its own, for frames drawn apart from the
	 * preview's (an export's). Destroy it once done.
	 */
	async createSimulationState(): Promise<SimulationState> {
		return new SimulationState((await this.ensureRenderer()).device);
	}

	/** Draw `frame` at `size` without reading it back, to step the simulations in `state`. */
	async simulate(frame: FrameInputs, size: Size, state: SimulationState) {
		const renderer = await this.ensureRenderer();
		if (!this.program) throw new Error("The shader hasn't compiled yet.");
		await renderer.simulate(this.program, frame, size, state);
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
		clearTimeout(this.recovery);
		this.player.destroy();
		this.program?.destroy();
		this.simulation?.destroy();
		for (const target of this.targets.values()) target?.destroy();
		this.renderer?.destroy();
	}

	private ensureRenderer(): Promise<Renderer> {
		this.rendererRequest ??= Renderer.create().then(
			(renderer) => {
				this.renderer = renderer;
				void renderer.framesInFlight.then((frames) => {
					if (this.renderer === renderer) this.player.maxFramesInFlight = frames;
				});
				this.simulation = new SimulationState(renderer.device);
				renderer.media.setFiles(this.mediaFiles);
				renderer.media.onChange = () => {
					this.player.invalidate();
				};
				renderer.onError = (message) => {
					if (this.error) return;
					console.error("[preview] GPU error:", message);
					this.error = { title: "GPU error", message };
				};
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

	/**
	 * After a device loss, start over with a new device: canvas, then program,
	 * unless losses keep following that program. A shader can hang the GPU,
	 * which then resets, so running it again would only do so again.
	 */
	private recover(info: GPUDeviceLostInfo) {
		if (this.destroyed || info.reason === "destroyed") return;
		console.warn("[preview] GPU device lost, recreating it:", info.message);
		const now = performance.now();
		this.losses = [...this.losses.filter((t) => now - t < LOSS_WINDOW_MS), now];
		if (this.losses.length >= MAX_LOSSES) {
			this.blockedCode = this.programCode;
			this.error = {
				title: "The GPU keeps resetting",
				message:
					"This shader stopped running, as the GPU reset each time it was drawn. Changing the graph tries again.",
			};
		}
		this.renderer = undefined;
		this.rendererRequest = undefined;
		this.simulation = undefined;
		this.program = undefined;
		this.programCode = undefined;
		for (const canvas of this.targets.keys()) this.targets.set(canvas, undefined);
		clearTimeout(this.recovery);
		this.recovery = setTimeout(
			() => {
				this.ensureRenderer().then(
					() => {
						this.connectCanvases();
						if (this.source) this.setSource(this.source);
					},
					() => undefined,
				);
			},
			RECOVERY_DELAY_MS * 2 ** (this.losses.length - 1),
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

	/** Draw `frame`; resolves when the GPU has finished it, if it drew. */
	private draw(frame: FrameInputs): Promise<void> | undefined {
		this.time = frame.time;
		this.frame = frame.frame;
		this.frameRate = this.player.meter.rate;
		const program = this.program;
		const simulation = this.simulation;
		if (!program || !simulation) return undefined;
		const timing = this.player.playing ? this.renderer?.timer?.begin() : undefined;
		for (const target of this.targets.values())
			target?.render(program, frame, simulation, timing);
		void timing?.end().then((seconds) => {
			if (seconds !== undefined) this.player.meter.recordGpuTime(seconds);
		});
		return this.renderer?.device.queue.onSubmittedWorkDone();
	}

	/**
	 * Measure the display's refresh rate. Playback holds animation frames back
	 * when the GPU falls behind, so a measure taken while playing only stands
	 * until one taken while paused (e.g. when the window moved to another display).
	 */
	private measureRefreshRate() {
		if (this.measuringRefreshRate) {
			this.remeasureRefreshRate = true;
			return;
		}
		this.measuringRefreshRate = true;
		const playing = this.player.playing;
		const playStarts = this.playStarts;
		void measureRefreshRate().then((rate) => {
			this.measuringRefreshRate = false;
			if (this.destroyed) return;
			const played = playing || this.player.playing || this.playStarts !== playStarts;
			if (!played || this.refreshRate === undefined) this.refreshRate = rate;
			if (this.remeasureRefreshRate) {
				this.remeasureRefreshRate = false;
				this.measureRefreshRate();
			}
		});
	}

	private syncPlayback() {
		if (this.playing && !this.player.playing) this.measureRefreshRate();
		if (!this.playing && this.player.playing) this.playStarts += 1;
		this.playing = this.player.playing;
		this.time = this.player.clock.time;
		this.frame = this.player.clock.frame;
		this.frameRate = this.player.meter.rate;
	}
}

export const [getPreview, setPreview] = createContext<Preview>();
