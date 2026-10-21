/**
 * Open a context menu at a point (client coordinates) from code, exactly as
 * a right-click there would: its trigger positions the menu from the event.
 */
export function openContextMenuAt(trigger: HTMLElement, x: number, y: number) {
	trigger.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
	);
}
