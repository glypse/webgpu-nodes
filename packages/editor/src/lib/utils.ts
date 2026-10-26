/**
 * Open a context menu at a point (client coordinates) from code, exactly as
 * a right-click there would: its trigger positions the menu from the event.
 */
export function openContextMenuAt(trigger: HTMLElement, x: number, y: number) {
	trigger.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
	);
}

/** Trigger a browser download of `blob`. */
export function downloadFile(filename: string, blob: Blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
