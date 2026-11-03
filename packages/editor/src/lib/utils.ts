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

/** Ask the user for files; resolves with none when they cancel. */
export function pickFiles(opts: { accept: string; multiple?: boolean }): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = opts.accept;
		if (opts.multiple) input.multiple = true;
		input.onchange = () => {
			resolve(Array.from(input.files ?? []));
		};
		input.oncancel = () => {
			resolve([]);
		};
		input.click();
	});
}

/** What the file picker accepts for media assets. */
export const MEDIA_ACCEPT = "image/*,video/*";
