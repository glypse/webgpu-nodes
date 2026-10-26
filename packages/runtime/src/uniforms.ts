import type { UniformBlock } from "$core";

export type BlockValue = number | readonly number[];

/** Write `values` into `target` at the offsets `block` lays out; fields without a value stay as they are. */
export function packBlock(
	block: UniformBlock,
	values: Readonly<Record<string, BlockValue>>,
	target: ArrayBuffer = new ArrayBuffer(block.size),
): ArrayBuffer {
	const floats = new Float32Array(target);
	const uints = new Uint32Array(target);
	for (const [name, field] of Object.entries(block.fields)) {
		const value = values[name];
		if (value === undefined) continue;
		const view = field.scalar === "u32" ? uints : floats;
		const start = field.offset / 4;
		for (let i = 0; i < field.components; i++) {
			view[start + i] = typeof value === "number" ? (i === 0 ? value : 0) : (value[i] ?? 0);
		}
	}
	return target;
}
