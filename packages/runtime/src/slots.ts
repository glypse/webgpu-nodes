/** `value` rounded up to a multiple of `alignment`. */
export function alignUp(value: number, alignment: number): number {
	return Math.ceil(value / alignment) * alignment;
}

/**
 * The copies of a uniform block that draws of one command buffer read, one
 * per slot, `stride` bytes apart so a draw can bind one with a dynamic
 * offset. Writes through the queue all land before the command buffer, so
 * a block can't be rewritten between draws: each draw gets a slot.
 */
export class SlotData {
	private bytes: Uint8Array;
	private count = 0;

	constructor(
		readonly size: number,
		readonly stride: number,
	) {
		this.bytes = new Uint8Array(stride);
	}

	/** The slots in use. */
	get length(): number {
		return this.count;
	}

	/** The bytes of the slots in use. */
	get used(): Uint8Array {
		return this.bytes.subarray(0, this.count * this.stride);
	}

	/** The offset of a slot holding `data`: the last one's when it holds the same. */
	add(data: ArrayBuffer): number {
		const block = new Uint8Array(data, 0, this.size);
		const last = (this.count - 1) * this.stride;
		if (this.count > 0 && sameBytes(this.bytes, last, block)) return last;
		const offset = this.count * this.stride;
		if (offset + this.stride > this.bytes.length) {
			const grown = new Uint8Array(Math.max(this.bytes.length * 2, offset + this.stride));
			grown.set(this.bytes);
			this.bytes = grown;
		}
		this.bytes.set(block, offset);
		this.count++;
		return offset;
	}

	reset() {
		this.count = 0;
	}
}

function sameBytes(bytes: Uint8Array, offset: number, block: Uint8Array): boolean {
	for (let i = 0; i < block.length; i++) if (bytes[offset + i] !== block[i]) return false;
	return true;
}

/** Slots past this are given back once a frame needs a fraction of them. */
const SHRINK_ABOVE = 64;
const SHRINK_RATIO = 4;

/**
 * `SlotData` kept in a GPU buffer. The buffer grows while a command buffer
 * is being encoded, so draws already encoded keep the buffer they bind:
 * every buffer used in an encode gets the data when it's flushed.
 */
export class SlotBuffer {
	private data: SlotData;
	private buffer: GPUBuffer;
	private capacity = 1;
	/** Buffers this encode has used, the current one last. */
	private inUse: GPUBuffer[];
	/** Buffers given up on, kept a frame longer than their command buffers might be encoded. */
	private superseded: GPUBuffer[] = [];
	private retired: GPUBuffer[] = [];

	constructor(
		private device: GPUDevice,
		size: number,
	) {
		const stride = alignUp(size, device.limits.minUniformBufferOffsetAlignment);
		this.data = new SlotData(size, stride);
		this.buffer = this.create(this.capacity);
		this.inUse = [this.buffer];
	}

	get current(): GPUBuffer {
		return this.buffer;
	}

	private create(slots: number): GPUBuffer {
		const size = slots * this.data.stride;
		if (size > this.device.limits.maxBufferSize) {
			throw new Error("A frame draws more passes than the device has room for.");
		}
		return this.device.createBuffer({
			size,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
	}

	/** Start a new encode: its slots start over. */
	begin() {
		for (const buffer of this.retired) buffer.destroy();
		this.retired = this.superseded;
		this.superseded = [];
		const last = this.data.length;
		if (this.capacity > SHRINK_ABOVE && last * SHRINK_RATIO < this.capacity) {
			this.capacity = Math.max(1, last * 2);
			this.buffer = this.create(this.capacity);
		}
		this.superseded.push(...this.inUse.filter((b) => b !== this.buffer));
		this.inUse = [this.buffer];
		this.data.reset();
	}

	/** The offset of a slot holding `data`. */
	add(data: ArrayBuffer): number {
		const offset = this.data.add(data);
		if (this.data.length > this.capacity) {
			this.capacity *= 2;
			this.buffer = this.create(this.capacity);
			this.inUse.push(this.buffer);
		}
		return offset;
	}

	/** Write the slots to the GPU; call once the encode's draws are all recorded. */
	flush() {
		const used = this.data.used;
		if (used.length === 0) return;
		for (const buffer of this.inUse) {
			this.device.queue.writeBuffer(buffer, 0, used, 0, Math.min(used.length, buffer.size));
		}
	}

	destroy() {
		for (const buffer of [...this.inUse, ...this.superseded, ...this.retired]) buffer.destroy();
		this.inUse = [];
		this.superseded = [];
		this.retired = [];
	}
}
