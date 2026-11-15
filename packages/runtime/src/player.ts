import { Clock, type Timing } from "./clock";
import { FrameMeter } from "./frame-meter";
import type { FrameInputs } from "./renderer";

/**
 * Plays a `Clock` on animation frames, calling `onFrame` whenever there is a
 * frame to draw: on each new frame while playing, and once after a seek or an
 * `invalidate` (e.g. a new program) while paused. `onFrame` may return a
 * promise of the frame being finished, and frames wait for it.
 */
export class Player {
	readonly clock: Clock;
	/** The rate frames are drawn at while playing; reset on play and pause. */
	readonly meter = new FrameMeter();
	/**
	 * Frames drawn but not finished yet before the next waits. A deeper queue
	 * lets a program too heavy for the display's rate pile up work, which the
	 * page's own compositing then waits behind, so the whole UI lags, not
	 * just the preview.
	 */
	maxFramesInFlight = 1;
	private playingState = false;
	private request: number | undefined;
	private lastTimestamp: number | undefined;
	private dirty = true;
	private framesInFlight = 0;

	constructor(
		timing: Timing,
		private onFrame: (frame: FrameInputs) => Promise<unknown> | undefined,
	) {
		this.clock = new Clock(timing);
		this.schedule();
	}

	get playing(): boolean {
		return this.playingState;
	}

	play() {
		if (this.playingState) return;
		this.playingState = true;
		this.lastTimestamp = undefined;
		this.meter.reset();
		this.schedule();
	}

	pause() {
		this.playingState = false;
		this.meter.reset();
	}

	toggle() {
		if (this.playingState) this.pause();
		else this.play();
	}

	seek(time: number) {
		this.clock.seek(time);
		this.invalidate();
	}

	step(frames: number) {
		this.pause();
		this.clock.step(frames);
		this.invalidate();
	}

	/**
	 * Play at `timing`, re-snapping time to its frame grid when it changes: in
	 * real time, frames count the display's refreshes, so a re-snap may move
	 * the frame (and restart simulations, for which it went back).
	 */
	setTiming(timing: Timing) {
		const current = this.clock.timing;
		if (current.fps === timing.fps && current.realtime === timing.realtime) return;
		this.clock.setTiming(timing);
		this.invalidate();
	}

	/** Draw the current frame again on the next animation frame. */
	invalidate() {
		this.dirty = true;
		this.schedule();
	}

	/** Draw the current frame right away rather than on the next animation frame. */
	drawNow() {
		this.draw();
	}

	destroy() {
		this.playingState = false;
		if (this.request !== undefined) cancelAnimationFrame(this.request);
		this.request = undefined;
	}

	private schedule() {
		this.request ??= requestAnimationFrame(this.loop);
	}

	private loop = (timestamp: number) => {
		this.request = undefined;
		if (this.playingState) {
			const elapsed =
				this.lastTimestamp === undefined ? 0 : (timestamp - this.lastTimestamp) / 1000;
			this.lastTimestamp = timestamp;
			if (this.clock.tick(elapsed)) this.dirty = true;
			this.schedule();
		}
		if (this.dirty && this.framesInFlight < this.maxFramesInFlight) {
			if (this.playingState) this.meter.record(timestamp);
			this.draw();
		}
	};

	private draw() {
		this.dirty = false;
		const finished = this.onFrame(this.clock);
		if (!finished) return;
		this.framesInFlight += 1;
		const release = () => {
			this.framesInFlight -= 1;
			if (this.dirty) this.schedule();
		};
		finished.then(release, release);
	}
}
