import { type Lch, encodeRgb, inSrgbGamut, oklchToLinearUnmapped } from "$core";
import type { Attachment } from "svelte/attachments";

/** Sub-samples per side for the pixels on the gamut's edge. */
const EDGE_SAMPLES = 4;

/**
 * Paints, pixel by pixel, the OKLch colour `at` gives for each point of the
 * canvas (in [0, 1] from its top left), leaving transparent those outside
 * the sRGB gamut. Pixels on the gamut's edge are sub-sampled, their opacity
 * the share of them inside, so the edge is smooth. Repaints when `at` changes.
 */
export function paintGamut(
	at: (x: number, y: number) => Lch | undefined,
): Attachment<HTMLCanvasElement> {
	return (canvas) => {
		const scale = window.devicePixelRatio;
		const width = Math.max(1, Math.round(canvas.clientWidth * scale));
		const height = Math.max(1, Math.round(canvas.clientHeight * scale));
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return;

		/** The encoded colour at a point, if sRGB can show it. */
		const sample = (x: number, y: number) => {
			const lch = at(x / width, y / height);
			const linear = lch && oklchToLinearUnmapped(lch);
			return linear && inSrgbGamut(linear) ? encodeRgb(linear) : undefined;
		};
		const centres = Array.from({ length: width * height }, (_, i) =>
			sample((i % width) + 0.5, Math.floor(i / width) + 0.5),
		);
		const inside = (x: number, y: number) =>
			x < 0 || y < 0 || x >= width || y >= height
				? undefined
				: centres[y * width + x] !== undefined;

		const image = context.createImageData(width, height);
		const put = (i: number, r: number, g: number, b: number, alpha: number) => {
			image.data[i * 4] = r * 255;
			image.data[i * 4 + 1] = g * 255;
			image.data[i * 4 + 2] = b * 255;
			image.data[i * 4 + 3] = alpha * 255;
		};
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = y * width + x;
				const centre = centres[i];
				const self = centre !== undefined;
				const edge = [
					inside(x - 1, y),
					inside(x + 1, y),
					inside(x, y - 1),
					inside(x, y + 1),
				].some((n) => n !== undefined && n !== self);
				if (!edge) {
					if (centre) put(i, centre.r, centre.g, centre.b, 1);
					continue;
				}
				let r = 0;
				let g = 0;
				let b = 0;
				let count = 0;
				for (let sy = 0; sy < EDGE_SAMPLES; sy++) {
					for (let sx = 0; sx < EDGE_SAMPLES; sx++) {
						const color = sample(
							x + (sx + 0.5) / EDGE_SAMPLES,
							y + (sy + 0.5) / EDGE_SAMPLES,
						);
						if (!color) continue;
						r += color.r;
						g += color.g;
						b += color.b;
						count++;
					}
				}
				if (count > 0) put(i, r / count, g / count, b / count, count / EDGE_SAMPLES ** 2);
			}
		}
		context.putImageData(image, 0, 0);
	};
}
