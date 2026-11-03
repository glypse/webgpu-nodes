/** Passes a frame can time: one per canvas it's drawn on. */
const MAX_PASSES = 8;
/** Frames read back at once; a frame drawn while all are pending isn't timed. */
const MAX_PENDING = 4;
const TIMESTAMP_BYTES = 8;

/**
 * Times render passes on the GPU, with timestamp queries. Only exists on
 * devices with the `timestamp-query` feature.
 */
export class GpuTimer {
	private free: FrameTiming[] = [];
	private pending = 0;

	private constructor(private device: GPUDevice) {}

	static create(device: GPUDevice): GpuTimer | undefined {
		return device.features.has("timestamp-query") ? new GpuTimer(device) : undefined;
	}

	/** Start timing a frame's passes; undefined while too many frames are being read back. */
	begin(): FrameTiming | undefined {
		const timing =
			this.free.pop() ??
			(this.pending < MAX_PENDING ? new FrameTiming(this.device) : undefined);
		if (!timing) return undefined;
		this.pending += 1;
		timing.onDone = () => {
			this.pending -= 1;
			this.free.push(timing);
		};
		return timing;
	}
}

/** The passes of one frame being timed. */
export class FrameTiming {
	onDone: (() => void) | undefined;
	private passes = 0;
	private querySet: GPUQuerySet;
	private resolveBuffer: GPUBuffer;
	private readBuffer: GPUBuffer;

	constructor(private device: GPUDevice) {
		const count = MAX_PASSES * 2;
		this.querySet = device.createQuerySet({ type: "timestamp", count });
		this.resolveBuffer = device.createBuffer({
			size: count * TIMESTAMP_BYTES,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		});
		this.readBuffer = device.createBuffer({
			size: count * TIMESTAMP_BYTES,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
	}

	/** The timestamp writes timing a pass; undefined once the frame has timed as many as it can. */
	pass(): GPURenderPassTimestampWrites | undefined {
		if (this.passes === MAX_PASSES) return undefined;
		const index = this.passes++ * 2;
		return {
			querySet: this.querySet,
			beginningOfPassWriteIndex: index,
			endOfPassWriteIndex: index + 1,
		};
	}

	/**
	 * Submit after the frame's passes; resolves with their total GPU time in
	 * seconds, or undefined when none was timed or the device was lost.
	 */
	async end(): Promise<number | undefined> {
		const passes = this.passes;
		this.passes = 0;
		try {
			if (passes === 0) return undefined;
			const count = passes * 2;
			const encoder = this.device.createCommandEncoder();
			encoder.resolveQuerySet(this.querySet, 0, count, this.resolveBuffer, 0);
			encoder.copyBufferToBuffer(
				this.resolveBuffer,
				0,
				this.readBuffer,
				0,
				count * TIMESTAMP_BYTES,
			);
			this.device.queue.submit([encoder.finish()]);
			await this.readBuffer.mapAsync(GPUMapMode.READ, 0, count * TIMESTAMP_BYTES);
			const stamps = new BigInt64Array(
				this.readBuffer.getMappedRange(0, count * TIMESTAMP_BYTES),
			);
			let total = 0n;
			for (let i = 0; i < count; i += 2) {
				const duration = (stamps[i + 1] ?? 0n) - (stamps[i] ?? 0n);
				// Some drivers write timestamps out of order across a pass.
				if (duration > 0n) total += duration;
			}
			this.readBuffer.unmap();
			return Number(total) / 1e9;
		} catch {
			return undefined;
		} finally {
			this.onDone?.();
		}
	}
}
