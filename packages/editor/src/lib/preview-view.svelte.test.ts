import { describe, expect, it } from "vitest";

import { PreviewView } from "./preview-view.svelte";

function view() {
	const v = new PreviewView();
	v.pane = { width: 400, height: 300 };
	v.dpr = 2;
	v.resolution = { width: 1600, height: 900 };
	return v;
}

describe("PreviewView", () => {
	it("fits the canvas into the pane until zoomed", () => {
		const v = view();
		expect(v.fitted).toBe(true);
		expect(v.zoom).toBe(0.5);
		expect(v.rect).toEqual({ x: 0, y: 37.5, width: 400, height: 225 });
	});

	it("keeps the point under the anchor in place while zooming", () => {
		const v = view();
		const anchor = { x: 100, y: 100 };
		const before = {
			x: (anchor.x - v.rect.x) / v.rect.width,
			y: (anchor.y - v.rect.y) / v.rect.height,
		};
		v.zoomBy(3, anchor);
		const after = {
			x: (anchor.x - v.rect.x) / v.rect.width,
			y: (anchor.y - v.rect.y) / v.rect.height,
		};
		expect(v.fitted).toBe(false);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it("shows pixels one to one at actual size, and fits again on demand", () => {
		const v = view();
		v.panBy(10, 0);
		v.actualSize();
		expect(v.rect.width).toBe(800);
		expect(v.rect.x).toBe(-200);
		v.fit();
		expect(v.zoom).toBe(0.5);
	});
});
