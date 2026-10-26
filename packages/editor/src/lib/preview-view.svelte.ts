import type { Size } from "$runtime";

export type Point = { x: number; y: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;
const ZOOM_STEP = 1.2;

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * How the canvas sits in the preview pane. Zoom is in device pixels per
 * canvas pixel, so 1 shows the canvas pixel for pixel. Until the user zooms
 * or pans, the canvas is fitted into the pane, following its resizes.
 */
export class PreviewView {
	/** The pane's size in CSS pixels. */
	pane = $state<Size>({ width: 0, height: 0 });
	/** Device pixels per CSS pixel. */
	dpr = $state(1);
	/** The canvas's size in pixels. */
	resolution = $state<Size>({ width: 0, height: 0 });

	/** A zoom and an offset of the canvas centre from the pane's (CSS pixels), or null to fit. */
	private manual = $state<{ zoom: number; x: number; y: number } | null>(null);

	readonly fitZoom = $derived.by(() => {
		const { width, height } = this.resolution;
		if (width === 0 || height === 0) return 1;
		return Math.min(
			(this.pane.width * this.dpr) / width,
			(this.pane.height * this.dpr) / height,
		);
	});

	readonly fitted = $derived(this.manual === null);
	readonly zoom = $derived(this.manual?.zoom ?? this.fitZoom);

	/**
	 * The canvas's rectangle in the pane, in CSS pixels, on whole device
	 * pixels so no edge is drawn half-covered.
	 */
	readonly rect = $derived.by(() => {
		const snap = (v: number) => Math.round(v * this.dpr) / this.dpr;
		const width = (this.resolution.width * this.zoom) / this.dpr;
		const height = (this.resolution.height * this.zoom) / this.dpr;
		return {
			x: snap(this.pane.width / 2 + (this.manual?.x ?? 0) - width / 2),
			y: snap(this.pane.height / 2 + (this.manual?.y ?? 0) - height / 2),
			width: snap(width),
			height: snap(height),
		};
	});

	fit() {
		this.manual = null;
	}

	/** Zoom to `zoom`, keeping the canvas point under `anchor` (pane CSS pixels) in place. */
	zoomTo(zoom: number, anchor: Point = { x: this.pane.width / 2, y: this.pane.height / 2 }) {
		const next = clampZoom(zoom);
		const scale = next / this.zoom;
		const centre = {
			x: this.pane.width / 2 + (this.manual?.x ?? 0),
			y: this.pane.height / 2 + (this.manual?.y ?? 0),
		};
		this.manual = {
			zoom: next,
			x: anchor.x - (anchor.x - centre.x) * scale - this.pane.width / 2,
			y: anchor.y - (anchor.y - centre.y) * scale - this.pane.height / 2,
		};
	}

	zoomBy(factor: number, anchor?: Point) {
		this.zoomTo(this.zoom * factor, anchor);
	}

	zoomIn() {
		this.zoomBy(ZOOM_STEP);
	}

	zoomOut() {
		this.zoomBy(1 / ZOOM_STEP);
	}

	/** Show the canvas pixel for pixel, centred. */
	actualSize() {
		this.manual = { zoom: 1, x: 0, y: 0 };
	}

	panBy(dx: number, dy: number) {
		const current = this.manual ?? { zoom: this.zoom, x: 0, y: 0 };
		this.manual = { zoom: current.zoom, x: current.x + dx, y: current.y + dy };
	}
}
