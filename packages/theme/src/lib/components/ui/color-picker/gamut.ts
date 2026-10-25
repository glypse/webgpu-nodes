import { type Lch, encodeRgb, inSrgbGamut, oklchToLinearUnmapped } from "$core";
import type { Attachment } from "svelte/attachments";

/**
 * Paints, pixel by pixel, the OKLch colour `at` gives for each point of the
 * canvas (in [0, 1] from its top left), leaving transparent those outside
 * the sRGB gamut. Repaints when `at` changes.
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
		const image = context.createImageData(width, height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const lch = at((x + 0.5) / width, (y + 0.5) / height);
				const linear = lch && oklchToLinearUnmapped(lch);
				if (!linear || !inSrgbGamut(linear)) continue;
				const { r, g, b } = encodeRgb(linear);
				const i = (y * width + x) * 4;
				image.data[i] = r * 255;
				image.data[i + 1] = g * 255;
				image.data[i + 2] = b * 255;
				image.data[i + 3] = 255;
			}
		}
		context.putImageData(image, 0, 0);
	};
}
