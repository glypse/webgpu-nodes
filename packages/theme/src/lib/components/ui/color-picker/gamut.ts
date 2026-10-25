import { type Lch, encodeRgb, inSrgbGamut, oklchToLinear, oklchToLinearUnmapped } from "$core";
import type { Attachment } from "svelte/attachments";

/** Sub-samples per side for the pixels on the gamut's edge. */
const EDGE_SAMPLES = 4;
/**
 * Spacing, in pixels, of the grid the colours outside the gamut are mapped
 * on: mapping each pixel is too slow to repaint while dragging, and mapped
 * colours change smoothly enough to interpolate between its points.
 */
const MAPPED_GRID = 6;
/** How much the outline covers the colour, at its middle. */
const OUTLINE_OPACITY = 0.85;

/**
 * Paints, pixel by pixel, the OKLch colour `at` gives for each point of the
 * canvas (in [0, 1] from its top left; transparent where it gives none).
 * Colours outside sRGB show what they're mapped to, and a thin line traces
 * the gamut's edge, anti-aliased by sub-sampling the pixels it crosses.
 * Repaints when `at` changes, at most once a frame.
 */
export function paintGamut(
	at: (x: number, y: number) => Lch | undefined,
): Attachment<HTMLCanvasElement> {
	return (canvas) => {
		const frame = requestAnimationFrame(() => {
			paint(canvas, at);
		});
		return () => {
			cancelAnimationFrame(frame);
		};
	};
}

function paint(canvas: HTMLCanvasElement, at: (x: number, y: number) => Lch | undefined) {
	const scale = window.devicePixelRatio;
	const width = Math.max(1, Math.round(canvas.clientWidth * scale));
	const height = Math.max(1, Math.round(canvas.clientHeight * scale));
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return;

	const lchAt = (x: number, y: number) => at(x / width, y / height);
	const fits = (lch: Lch) => inSrgbGamut(oklchToLinearUnmapped(lch));

	// Per pixel: 1 inside the gamut, 0 outside, -1 where nothing is drawn;
	// its encoded colour when inside, and its lightness.
	const state = new Int8Array(width * height);
	const colors = new Float32Array(width * height * 3);
	const lightness = new Float32Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const lch = lchAt((i % width) + 0.5, Math.floor(i / width) + 0.5);
		if (!lch) {
			state[i] = -1;
			continue;
		}
		lightness[i] = lch.l;
		const linear = oklchToLinearUnmapped(lch);
		if (!inSrgbGamut(linear)) continue;
		state[i] = 1;
		const { r, g, b } = encodeRgb(linear);
		colors.set([r, g, b], i * 3);
	}

	const columns = Math.ceil(width / MAPPED_GRID) + 1;
	const rows = Math.ceil(height / MAPPED_GRID) + 1;
	const mapped = Array.from({ length: columns * rows }, (_, i) => {
		const lch = lchAt((i % columns) * MAPPED_GRID, Math.floor(i / columns) * MAPPED_GRID);
		return lch && encodeRgb(oklchToLinear(lch));
	});
	/** A mapped colour between the grid's points, or exactly when one is missing. */
	const mappedAt = (x: number, y: number) => {
		const gx = (x + 0.5) / MAPPED_GRID;
		const gy = (y + 0.5) / MAPPED_GRID;
		const x0 = Math.floor(gx);
		const y0 = Math.floor(gy);
		const a = mapped[y0 * columns + x0];
		const b = mapped[y0 * columns + x0 + 1];
		const c = mapped[(y0 + 1) * columns + x0];
		const d = mapped[(y0 + 1) * columns + x0 + 1];
		if (!a || !b || !c || !d) {
			const lch = lchAt(x + 0.5, y + 0.5);
			return lch ? encodeRgb(oklchToLinear(lch)) : { r: 0, g: 0, b: 0 };
		}
		const tx = gx - x0;
		const ty = gy - y0;
		const mix = (k: "r" | "g" | "b") =>
			(a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (c[k] * (1 - tx) + d[k] * tx) * ty;
		return { r: mix("r"), g: mix("g"), b: mix("b") };
	};
	/** Whether a neighbour is drawn and on the other side of the gamut's edge. */
	const across = (x: number, y: number, inside: number) =>
		x >= 0 && y >= 0 && x < width && y < height && (state[y * width + x] ?? -1) === 1 - inside;

	const image = context.createImageData(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const inside = state[i] ?? -1;
			if (inside === -1) continue;
			let r: number;
			let g: number;
			let b: number;
			if (inside === 1) {
				r = colors[i * 3] ?? 0;
				g = colors[i * 3 + 1] ?? 0;
				b = colors[i * 3 + 2] ?? 0;
			} else {
				({ r, g, b } = mappedAt(x, y));
			}
			const edge =
				across(x - 1, y, inside) ||
				across(x + 1, y, inside) ||
				across(x, y - 1, inside) ||
				across(x, y + 1, inside);
			if (edge) {
				let fitting = 0;
				let samples = 0;
				for (let sy = 0; sy < EDGE_SAMPLES; sy++) {
					for (let sx = 0; sx < EDGE_SAMPLES; sx++) {
						const lch = lchAt(
							x + (sx + 0.5) / EDGE_SAMPLES,
							y + (sy + 0.5) / EDGE_SAMPLES,
						);
						if (!lch) continue;
						samples++;
						if (fits(lch)) fitting++;
					}
				}
				// The share inside tells, roughly, how far the edge passes from the
				// pixel's centre (half a pixel when it only grazes it): the line
				// fades over that distance, split between the pixels either side.
				const share = samples > 0 ? fitting / samples : 0;
				const distance = Math.abs(share - 0.5);
				const line = Math.max(0, 1 - 1.5 * distance) * OUTLINE_OPACITY;
				// Dark on light colours, light on dark ones.
				const ink = (lightness[i] ?? 0) > 0.6 ? 0 : 1;
				r += (ink - r) * line;
				g += (ink - g) * line;
				b += (ink - b) * line;
			}
			image.data[i * 4] = r * 255;
			image.data[i * 4 + 1] = g * 255;
			image.data[i * 4 + 2] = b * 255;
			image.data[i * 4 + 3] = 255;
		}
	}
	context.putImageData(image, 0, 0);
}
