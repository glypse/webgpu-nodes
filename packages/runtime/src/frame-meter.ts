export type FrameRate = {
	/** Frames drawn per second. */
	fps: number;
	/** Mean time between frames, in seconds. */
	frameTime: number;
	/** Longest time between two frames, in seconds: a stutter the mean hides. */
	worstFrameTime: number;
	/** Mean time the GPU spent drawing a frame, in seconds, when it was timed. */
	gpuTime?: number;
};

/**
 * Measures the rate frames are drawn at, over windows of `window` seconds so
 * that the rate shown holds still long enough to be read.
 */
export class FrameMeter {
	rate: FrameRate | undefined;
	private start: number | undefined;
	private last = 0;
	private count = 0;
	private worst = 0;
	private gpuTotal = 0;
	private gpuCount = 0;

	constructor(private window = 1) {}

	/** Count a frame drawn at `timestamp` milliseconds. */
	record(timestamp: number) {
		if (this.start === undefined) {
			this.start = this.last = timestamp;
			return;
		}
		this.count += 1;
		this.worst = Math.max(this.worst, timestamp - this.last);
		this.last = timestamp;
		const elapsed = (timestamp - this.start) / 1000;
		if (elapsed < this.window) return;
		this.rate = {
			fps: this.count / elapsed,
			frameTime: elapsed / this.count,
			worstFrameTime: this.worst / 1000,
			...(this.gpuCount > 0 ? { gpuTime: this.gpuTotal / this.gpuCount } : {}),
		};
		this.start = timestamp;
		this.clearWindow();
	}

	/** Count the GPU time of a frame drawn in the current window, in seconds. */
	recordGpuTime(seconds: number) {
		if (this.start === undefined) return;
		this.gpuTotal += seconds;
		this.gpuCount += 1;
	}

	reset() {
		this.rate = undefined;
		this.start = undefined;
		this.clearWindow();
	}

	private clearWindow() {
		this.count = 0;
		this.worst = 0;
		this.gpuTotal = 0;
		this.gpuCount = 0;
	}
}
