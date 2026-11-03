import type { FrameInputs } from "./renderer";

export type Timing = {
	/** Frames per second: the rate of fixed-rate playback and exports. */
	fps: number;
	/** Draw on every display refresh, time following the wall clock, rather than at `fps`. */
	realtime: boolean;
};

/** Longest step real-time playback takes, so a stall (e.g. a hidden tab) doesn't jump ahead. */
const MAX_REALTIME_DELTA = 0.1;
/** Longest catch-up fixed-rate playback does after a stall. */
const MAX_FIXED_CATCH_UP = 1;

/**
 * Project time. At a fixed rate, time is always `frame / fps` and delta
 * `1 / fps`, so a frame looks the same however it's reached (playback, a
 * seek, an export). In real time, time follows the wall clock.
 */
export class Clock implements FrameInputs {
	time = 0;
	delta = 0;
	frame = 0;
	/** Wall-clock seconds since the current fixed-rate frame was due; negative when it was drawn early. */
	private carry = 0;

	constructor(public timing: Timing) {}

	get frameDuration(): number {
		return 1 / this.timing.fps;
	}

	/** Advance by `elapsed` wall-clock seconds; returns whether a new frame is due. */
	tick(elapsed: number): boolean {
		if (this.timing.realtime) {
			this.delta = Math.min(Math.max(elapsed, 0), MAX_REALTIME_DELTA);
			this.time += this.delta;
			this.frame += 1;
			return true;
		}
		const wall = Math.max(elapsed, 0);
		this.carry = Math.min(this.carry + wall, MAX_FIXED_CATCH_UP);
		// Draw the frame due nearest this animation frame, not the last one already due:
		// when animation frames come as often as frames are due, their jitter would
		// otherwise leave some just short of a frame, skipping that draw and doubling the
		// next step. Leading by half an interval keeps the phase away from that edge.
		const lead = Math.min(wall, this.frameDuration) / 2;
		// The epsilon absorbs float error in elapsed times summing to exactly a frame.
		const steps = Math.floor((this.carry + lead) * this.timing.fps + 1e-6);
		if (steps === 0) return false;
		this.carry -= steps / this.timing.fps;
		this.setFrame(this.frame + steps);
		return true;
	}

	/** Jump to `time` seconds; at a fixed rate, to the frame showing it. */
	seek(time: number) {
		this.carry = 0;
		const clamped = Math.max(0, time);
		if (this.timing.realtime) {
			this.time = clamped;
			this.frame = Math.floor(clamped * this.timing.fps);
			this.delta = 0;
		} else {
			this.setFrame(Math.floor(clamped * this.timing.fps + 1e-6));
		}
	}

	/** Move by whole frames (of `fps`, in real time too). */
	step(frames: number) {
		this.carry = 0;
		if (this.timing.realtime) {
			this.time = Math.max(0, this.time + frames * this.frameDuration);
			this.frame = Math.max(0, this.frame + frames);
		} else {
			this.setFrame(this.frame + frames);
		}
	}

	/** Re-snap to the new timing's frame grid. */
	setTiming(timing: Timing) {
		this.timing = timing;
		this.seek(this.time);
	}

	private setFrame(frame: number) {
		this.frame = Math.max(0, frame);
		this.time = this.frame / this.timing.fps;
		this.delta = this.frameDuration;
	}
}
