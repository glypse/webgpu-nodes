import type { RenderPlan, StateRead, TextureFormat } from "$core";

import type { FrameInputs, Size } from "./renderer";

/** A simulation's last step: the frame it was drawn for, and the seconds it stepped by. */
export type StepRecord = { frame: number; time: number; delta: number };

/**
 * What a simulation does on a frame: start over from its initial values,
 * advance from the previous frame's state, or compute the frame it last
 * did again (e.g. after a change while paused) from the same state, taking
 * `delta` seconds as its step.
 */
export type Step = { kind: "start" | "advance" | "repeat"; delta: number };

/** How a simulation that last stepped for `last` (if it has) goes on to `frame`. */
export function nextStep(last: StepRecord | undefined, frame: FrameInputs): Step {
	if (!last || frame.frame === 0 || frame.frame < last.frame) return { kind: "start", delta: 0 };
	if (frame.frame === last.frame) return { kind: "repeat", delta: last.delta };
	// Frames may have been skipped: the step covers all the time since the last.
	return { kind: "advance", delta: Math.max(0, frame.time - last.time) };
}

/** The two textures keeping a state item, which swap roles as frames go by. */
type Pair = {
	format: TextureFormat;
	simulation: string;
	textures: [GPUTexture, GPUTexture];
	/** The index of this frame's texture; the other is the previous frame's. */
	current: 0 | 1;
};

/**
 * The state of a plan's simulations kept between the frames drawn to one
 * target (a preview, an export): each state item's texture of the previous
 * frame and of this one, and how each simulation last stepped. It outlives
 * plans: a new one keeps the state of the simulations it shares with the
 * last, as long as their items keep their formats and the size stays the same.
 */
export class SimulationState {
	private pairs = new Map<string, Pair>();
	private steps = new Map<string, StepRecord>();

	constructor(private device: GPUDevice) {}

	/**
	 * Begin drawing `frame` of `plan` at `size`: make the textures it keeps
	 * state in where they're missing or don't fit (their simulations then
	 * start over), and step each simulation. Returns their steps, by id.
	 */
	advance(plan: RenderPlan, frame: FrameInputs, size: Size): ReadonlyMap<string, Step> {
		const fresh = new Set<string>();
		const used = new Set<string>();
		const simulations = new Set<string>();
		for (const resource of plan.resources) {
			if (resource.kind !== "state") continue;
			used.add(resource.texture);
			simulations.add(resource.simulation);
			const pair = this.pairs.get(resource.texture);
			const [texture] = pair?.textures ?? [];
			if (
				pair?.format === resource.format &&
				pair.simulation === resource.simulation &&
				texture?.width === size.width &&
				texture.height === size.height
			) {
				continue;
			}
			if (pair) destroyPair(pair);
			this.pairs.set(resource.texture, {
				format: resource.format,
				simulation: resource.simulation,
				textures: [
					this.createTexture(resource.format, size),
					this.createTexture(resource.format, size),
				],
				current: 0,
			});
			fresh.add(resource.simulation);
		}
		for (const [id, pair] of this.pairs) {
			if (used.has(id)) continue;
			destroyPair(pair);
			this.pairs.delete(id);
		}
		for (const id of this.steps.keys()) if (!simulations.has(id)) this.steps.delete(id);

		const steps = new Map<string, Step>();
		for (const id of simulations) {
			const step: Step = fresh.has(id)
				? { kind: "start", delta: 0 }
				: nextStep(this.steps.get(id), frame);
			if (step.kind === "advance") {
				for (const pair of this.pairs.values()) {
					if (pair.simulation === id) pair.current = pair.current === 0 ? 1 : 0;
				}
			}
			this.steps.set(id, { frame: frame.frame, time: frame.time, delta: step.delta });
			steps.set(id, step);
		}
		return steps;
	}

	/** The texture keeping a state item (by `stateTextureId`), as of `read`'s frame. */
	texture(texture: string, read: StateRead): GPUTexture | undefined {
		const pair = this.pairs.get(texture);
		if (!pair) return undefined;
		return pair.textures[read === "current" ? pair.current : 1 - pair.current];
	}

	/** Forget every simulation's state: they all start over on the next frame. */
	reset() {
		for (const pair of this.pairs.values()) destroyPair(pair);
		this.pairs.clear();
		this.steps.clear();
	}

	destroy() {
		this.reset();
	}

	private createTexture(format: TextureFormat, { width, height }: Size): GPUTexture {
		return this.device.createTexture({
			size: { width, height },
			format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
	}
}

function destroyPair(pair: Pair) {
	for (const texture of pair.textures) texture.destroy();
}
