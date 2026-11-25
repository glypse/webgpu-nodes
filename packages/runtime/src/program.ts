import {
	type ColorSpace,
	DISPLAY_P3_FIELD,
	type FrameValues,
	type ShaderProgram,
	SIMULATION_DELTA_FIELD,
	type UniformValue,
} from "$core";

import type { TextureOf } from "./media";
import type { FrameInputs, Size } from "./renderer";
import { SlotBuffer } from "./slots";
import { packBlock } from "./uniforms";

/** The frame values of a pass of the size given, which its program reads. */
export type FrameValuesOf = (passSize: Size) => FrameValues;

/** Bind groups kept for each program: one per set of textures it has read. */
const BIND_GROUP_CACHE_SIZE = 32;

/** A pass ready to be encoded: its blocks are in slots, bound by the offsets. */
export type Draw = {
	pipeline: GPURenderPipeline;
	bindGroup: GPUBindGroup;
	/** Dynamic offsets, in the order of the bindings that have one. */
	offsets: number[];
	targets: GPUTexture[];
};

let nextId = 0;
const ids = new WeakMap<object, number>();
const idOf = (object: object): number => {
	let id = ids.get(object);
	if (id === undefined) ids.set(object, (id = nextId++));
	return id;
};

/**
 * A compiled program with its own uniform buffers: one pass of a
 * `CompiledPlan`. A pass runs many times in a command buffer when it's in
 * a loop, so the frame and frame value blocks have a slot for each draw.
 */
export class CompiledProgram {
	private frameData: ArrayBuffer;
	private frameValuesData: ArrayBuffer;
	private frameSlots: SlotBuffer;
	private valueSlots: SlotBuffer;
	private uniformBuffer: GPUBuffer;
	/** The frame block's fields, which a plan's update may point at other values. */
	private frameValues: ShaderProgram["frameValues"];
	private bindGroups = new Map<string, GPUBindGroup>();

	constructor(
		private device: GPUDevice,
		readonly program: ShaderProgram,
		readonly pipeline: GPURenderPipeline,
		private layout: GPUBindGroupLayout,
		private empty: GPUTexture,
		private samplers: readonly GPUSampler[],
	) {
		this.frameData = new ArrayBuffer(program.frame.size);
		this.frameSlots = new SlotBuffer(device, program.frame.size);
		this.uniformBuffer = device.createBuffer({
			size: program.uniforms.size,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.frameValues = program.frameValues;
		this.frameValuesData = new ArrayBuffer(program.frameValues.size);
		this.valueSlots = new SlotBuffer(device, program.frameValues.size);
	}

	/** Read the frame values from where `program` (the same code as before) says. */
	setFrameValues(frameValues: ShaderProgram["frameValues"]) {
		this.frameValues = frameValues;
	}

	/** The bind group reading `textures` and the blocks' current buffers. */
	private bindGroupOf(textures: readonly GPUTexture[]): GPUBindGroup {
		const frameBuffer = this.frameSlots.current;
		const valuesBuffer = this.valueSlots.current;
		const key = [frameBuffer, valuesBuffer, ...textures].map(idOf).join(",");
		const known = this.bindGroups.get(key);
		if (known) {
			// Most recently used last, so eviction drops the least recently used.
			this.bindGroups.delete(key);
			this.bindGroups.set(key, known);
			return known;
		}
		const bindGroup = this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{
					binding: this.program.frame.binding,
					resource: { buffer: frameBuffer, size: this.program.frame.size },
				},
				{
					binding: this.program.uniforms.binding,
					resource: { buffer: this.uniformBuffer },
				},
				{
					binding: this.program.frameValues.binding,
					resource: { buffer: valuesBuffer, size: this.program.frameValues.size },
				},
				...this.program.textures.map((t, i) => ({
					binding: t.binding,
					resource: (textures[i] ?? this.empty).createView(),
				})),
				...this.program.samplers.map((s, i) => ({
					binding: s.binding,
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- one per program sampler
					resource: this.samplers[i]!,
				})),
			],
		});
		this.bindGroups.set(key, bindGroup);
		for (const old of this.bindGroups.keys()) {
			if (this.bindGroups.size <= BIND_GROUP_CACHE_SIZE) break;
			this.bindGroups.delete(old);
		}
		return bindGroup;
	}

	setUniforms(values: Readonly<Record<string, UniformValue>>) {
		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			packBlock(this.program.uniforms, values),
		);
	}

	/** Start recording the draws of a command buffer. */
	begin() {
		this.frameSlots.begin();
		this.valueSlots.begin();
	}

	/** Write what was recorded; call after the last `record` and before submitting. */
	flush() {
		this.frameSlots.flush();
		this.valueSlots.flush();
	}

	/**
	 * Record a pass drawing into `targets` (a colour attachment each, of the
	 * canvas' size), for a frame presented in `colorSpace`, reading
	 * `textureOf`'s textures. `simulationDelta` is the step of the
	 * simulation it computes something of.
	 */
	record(
		targets: readonly GPUTexture[],
		frame: FrameInputs,
		colorSpace: ColorSpace,
		textureOf: TextureOf,
		{
			simulationDelta = 0,
			frameValuesOf,
		}: {
			simulationDelta?: number;
			frameValuesOf?: FrameValuesOf;
		} = {},
	): Draw {
		const [first] = targets;
		packBlock(
			this.program.frame,
			{
				...frame,
				resolution: [first?.width ?? 0, first?.height ?? 0],
				[DISPLAY_P3_FIELD]: colorSpace === "display-p3" ? 1 : 0,
				[SIMULATION_DELTA_FIELD]: simulationDelta,
			},
			this.frameData,
		);
		const frameOffset = this.frameSlots.add(this.frameData);
		const fields = Object.entries(this.frameValues.fields);
		if (fields.length > 0 && frameValuesOf) {
			const values = frameValuesOf({ width: first?.width ?? 0, height: first?.height ?? 0 });
			packBlock(
				this.frameValues,
				Object.fromEntries(fields.map(([name, field]) => [name, values.ref(field.ref)])),
				this.frameValuesData,
			);
		}
		const valuesOffset = this.valueSlots.add(this.frameValuesData);
		const bindGroup = this.bindGroupOf(this.program.textures.map((t) => textureOf(t.source)));
		// Dynamic offsets follow the order of the bindings.
		const offsets =
			this.program.frame.binding < this.program.frameValues.binding
				? [frameOffset, valuesOffset]
				: [valuesOffset, frameOffset];
		return { pipeline: this.pipeline, bindGroup, offsets, targets: [...targets] };
	}

	destroy() {
		this.frameSlots.destroy();
		this.valueSlots.destroy();
		this.uniformBuffer.destroy();
		this.bindGroups.clear();
	}
}

const firstLevelViews = new WeakMap<GPUTexture, GPUTextureView>();

/** A view of a texture's first level, which a pass draws into: one level at a time, the rest are made after the pass. */
function firstLevel(texture: GPUTexture): GPUTextureView {
	let view = firstLevelViews.get(texture);
	if (!view) {
		view = texture.createView({ baseMipLevel: 0, mipLevelCount: 1 });
		firstLevelViews.set(texture, view);
	}
	return view;
}

/** Encode a recorded pass. */
export function encodeDraw(
	encoder: GPUCommandEncoder,
	draw: Draw,
	timestampWrites?: GPURenderPassTimestampWrites,
) {
	const pass = encoder.beginRenderPass({
		colorAttachments: draw.targets.map((target) => ({
			view: firstLevel(target),
			loadOp: "clear" as const,
			storeOp: "store" as const,
		})),
		...(timestampWrites ? { timestampWrites } : {}),
	});
	pass.setPipeline(draw.pipeline);
	pass.setBindGroup(0, draw.bindGroup, draw.offsets);
	pass.draw(3);
	pass.end();
}
