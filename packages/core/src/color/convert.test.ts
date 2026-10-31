import { describe, expect, it } from "vitest";

import {
	hexToLinear,
	hsvToRgb,
	linearToHex,
	linearToOklch,
	oklchToLinear,
	rgbToHsv,
	srgbDecode,
	srgbEncode,
} from "./convert";

const close = (actual: Record<string, number>, expected: Record<string, number>, digits = 4) => {
	for (const [key, value] of Object.entries(expected)) {
		expect(actual[key], key).toBeCloseTo(value, digits);
	}
};

describe("colour conversions", () => {
	it("round-trips the sRGB transfer function", () => {
		for (const n of [0, 0.001, 0.2, 0.5, 1])
			expect(srgbDecode(srgbEncode(n))).toBeCloseTo(n, 6);
		expect(srgbEncode(0.214)).toBeCloseTo(0.5, 2);
	});

	it("converts between RGB and HSV", () => {
		close(rgbToHsv({ r: 1, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
		close(rgbToHsv({ r: 0, g: 0.5, b: 0.5 }), { h: 0.5, s: 1, v: 0.5 });
		close(rgbToHsv({ r: 0.3, g: 0.3, b: 0.3 }), { h: 0, s: 0, v: 0.3 });
		for (const hsv of [
			{ h: 0.1, s: 0.4, v: 0.9 },
			{ h: 0.7, s: 1, v: 0.2 },
			{ h: 0.95, s: 0.5, v: 0.5 },
		]) {
			close(rgbToHsv(hsvToRgb(hsv)), hsv);
		}
	});

	it("converts between linear RGB and OKLch", () => {
		// Reference values from Björn Ottosson's OKLab post.
		close(linearToOklch({ r: 1, g: 1, b: 1 }), { l: 1, c: 0 }, 3);
		close(linearToOklch({ r: 1, g: 0, b: 0 }), { l: 0.628, c: 0.2577, h: 29.23 }, 2);
		const rgb = { r: 0.2, g: 0.5, b: 0.1 };
		close(oklchToLinear(linearToOklch(rgb)), rgb, 5);
	});

	it("reads and writes sRGB-encoded hex", () => {
		expect(linearToHex({ r: 1, g: 0, b: srgbDecode(0.5), a: 1 }, false)).toBe("#FF0080");
		expect(linearToHex({ r: 2, g: -1, b: 0, a: 0.5 }, true)).toBe("#FF000080");
		close(hexToLinear("#ff0080") ?? {}, { r: 1, g: 0, b: srgbDecode(128 / 255), a: 1 });
		close(hexToLinear("f008") ?? {}, { r: 1, g: 0, b: 0, a: 136 / 255 });
		expect(hexToLinear("#12345")).toBeUndefined();
		expect(hexToLinear("nothex")).toBeUndefined();
	});

	it("reads and writes hex in Display P3", () => {
		const outsideSrgb = oklchToLinear({ l: 0.7015, c: 0.1559, h: 203.59 }, "display-p3");
		const hex = linearToHex({ ...outsideSrgb, a: 1 }, false, "display-p3");
		expect(hex).toBe("#16B6C7");
		close(hexToLinear(hex, "display-p3") ?? {}, outsideSrgb, 2);
		expect(linearToHex({ r: 1, g: 1, b: 1, a: 1 }, false, "display-p3")).toBe("#FFFFFF");
	});
});
