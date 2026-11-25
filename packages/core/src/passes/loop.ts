import { simulationId, type SimulationRef, type SimulationState } from "./simulation";

/**
 * A Repeat Passes zone as computed at `path`, by its input's id. Zones of
 * every kind have distinct ids within a document, so the id of a loop
 * never clashes with a simulation's.
 */
export type LoopRef = SimulationRef;

export const loopId = simulationId;

/** A loop's items, as computed at its instance: the same as a simulation's. */
export type LoopState = SimulationState;

/**
 * Which texture of an item's pair is read or written. During an iteration
 * `current` holds the item's value and `next` receives its next one; after
 * the loop `final` is the value it ended with, which is the initial one when
 * there were no iterations.
 */
export type LoopRead = "current" | "next" | "final";

/** What a loop's passes compute: the items' initial values, or their next ones. */
export type LoopStage = "start" | "next";

/** The id of the texture pair keeping an item of a loop instance. */
export function loopTextureId(loop: LoopRef, item: string): string {
	return `loop:${loopId(loop)}:${item}`;
}

/** The id of the resource a read of an item's texture pair is. */
export function loopReadId(texture: string, read: LoopRead): string {
	return `${texture}:${read}`;
}

/** The frame source giving the iteration a loop is at. */
export function iterationSource(loop: string): `iteration:${string}` {
	return `iteration:${loop}`;
}
