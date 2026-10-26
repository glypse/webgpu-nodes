import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";

/**
 * Calls `onpick` with the pointer and the element's bounds on press and
 * while it moves pressed, even outside the element.
 */
export function drag(
	onpick: (event: PointerEvent, rect: DOMRect) => void,
): Attachment<HTMLElement> {
	return (element) => {
		// Tracked here rather than with `hasPointerCapture`, which still holds
		// for a moment after release: a click right after would pick again.
		let pressed: number | undefined;
		const pick = (event: PointerEvent) => {
			onpick(event, element.getBoundingClientRect());
		};
		const release = (event: PointerEvent) => {
			if (event.pointerId === pressed) pressed = undefined;
		};
		const cleanups = [
			on(element, "pointerdown", (event) => {
				pressed = event.pointerId;
				element.setPointerCapture(event.pointerId);
				pick(event);
			}),
			on(element, "pointermove", (event) => {
				if (event.pointerId === pressed) pick(event);
			}),
			on(element, "pointerup", release),
			on(element, "pointercancel", release),
		];
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	};
}
