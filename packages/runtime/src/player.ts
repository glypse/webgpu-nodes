import { Clock, type Timing } from "./clock";
import type { FrameInputs } from "./renderer";

/**
 * Plays a `Clock` on animation frames, calling `onFrame` whenever there is a
 * frame to draw: on each new frame while playing, and once after a seek or an
 * `invalidate` (e.g. a new program) while paused.
 */
export class Player {
	readonly clock: Clock;
	private playingState = false;
	private request: number | undefined;
	private lastTimestamp: number | undefined;
	private dirty = true;

	constructor(
		timing: Timing,
		private onFrame: (frame: FrameInputs) => void,
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
		this.schedule();
	}

	pause() {
		this.playingState = false;
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

	setTiming(timing: Timing) {
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
		this.dirty = false;
		this.onFrame(this.clock);
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
		if (this.dirty) {
			this.dirty = false;
			this.onFrame(this.clock);
		}
	};
}
