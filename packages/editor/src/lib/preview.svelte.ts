import { type ShaderSource, buildProgram } from "$core";
import {
	CanvasTarget,
	type ColorSpace,
	type CompiledProgram,
	type FrameInputs,
	Player,
	ProgramError,
	Renderer,
	type Size,
	type Timing,
} from "$runtime";
import { createContext } from "svelte";

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
 * lost), the compiled program, the canvas it presents to, and playback.
 */
export class Preview {
	error = $state<PreviewError | null>(null);
	playing = $state(false);
	time = $state(0);
	frame = $state(0);

	readonly player: Player;

	private renderer: Renderer | undefined;
	private rendererRequest: Promise<Renderer> | undefined;
	private target: CanvasTarget | undefined;
	private canvas: HTMLCanvasElement | undefined;
	private size: Size = { width: 0, height: 0 };
	private colorSpace: ColorSpace = "srgb";

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

	/** Present on `canvas` from now on; returns a function detaching it. */
	attach(canvas: HTMLCanvasElement): () => void {
		this.canvas = canvas;
		// A failure is shown as the preview's error.
		this.ensureRenderer().then(
			() => {
				this.connectCanvas();
			},
			() => undefined,
		);
		return () => {
			if (this.canvas !== canvas) return;
			this.target?.destroy();
			this.target = undefined;
			this.canvas = undefined;
		};
	}

	/** Set the render resolution and colour space of the canvas. */
	configure(size: Size, colorSpace: ColorSpace) {
		this.size = size;
		this.colorSpace = colorSpace;
		this.target?.configure(size, colorSpace);
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

	destroy() {
		this.destroyed = true;
		this.player.destroy();
		this.program?.destroy();
		this.target?.destroy();
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
		this.target = undefined;
		this.ensureRenderer().then(
			() => {
				this.connectCanvas();
				if (this.source) this.setSource(this.source);
			},
			() => undefined,
		);
	}

	private connectCanvas() {
		if (!this.renderer || !this.canvas || this.target?.canvas === this.canvas) return;
		this.target = new CanvasTarget(this.renderer, this.canvas);
		this.target.configure(this.size, this.colorSpace);
		this.player.invalidate();
	}

	private draw(frame: FrameInputs) {
		this.time = frame.time;
		this.frame = frame.frame;
		if (this.program) this.target?.render(this.program, frame);
	}

	private syncPlayback() {
		this.playing = this.player.playing;
		this.time = this.player.clock.time;
		this.frame = this.player.clock.frame;
	}
}

export const [getPreview, setPreview] = createContext<Preview>();
