import { describe, expect, it } from "vitest";

import {
	type Area,
	type Rect,
	type Screen,
	closeArea,
	dockArea,
	edgeAt,
	joinAreas,
	moveEdge,
	splitArea,
	swapAreas,
} from "./screen";

const TOLERANCE = { width: 0.05, height: 0.05 };
const NONE = { width: 0, height: 0 };

function ids() {
	let n = 0;
	return () => `new-${String(n++)}`;
}

function area(id: string, left: number, top: number, right: number, bottom: number): Area {
	return { id, rect: { left, top, right, bottom }, editor: { type: "preview" } };
}

function rects(screen: Screen | undefined): Record<string, Rect> {
	if (!screen) throw new Error("operation refused");
	return Object.fromEntries(screen.areas.map((a) => [a.id, a.rect]));
}

/** A tall area on the left, two stacked ones on the right. */
const T_LAYOUT: Screen = {
	areas: [area("a", 0, 0, 0.5, 1), area("b", 0.5, 0, 1, 0.5), area("c", 0.5, 0.5, 1, 1)],
};

describe("splitArea", () => {
	it("cuts an area at a line, the new one taking the asked side and a copy of the editor", () => {
		const screen = {
			areas: [{ ...area("a", 0, 0, 1, 1), editor: { type: "graph", path: ["g"] } }],
		};
		const split = splitArea(screen as Screen, "a", "x", 0.25, "n", "before");
		expect(rects(split)).toEqual({
			a: { left: 0.25, top: 0, right: 1, bottom: 1 },
			n: { left: 0, top: 0, right: 0.25, bottom: 1 },
		});
		expect(split?.areas[1]?.editor).toEqual({ type: "graph", path: ["g"] });
	});

	it("refuses parts smaller than the minimum", () => {
		expect(splitArea(T_LAYOUT, "a", "y", 0.02, "n", "after", TOLERANCE)).toBeUndefined();
	});
});

describe("joinAreas", () => {
	it("grows an area over a neighbour sharing its whole edge", () => {
		expect(rects(joinAreas(T_LAYOUT, "b", "c", TOLERANCE, ids()))).toEqual({
			a: { left: 0, top: 0, right: 0.5, bottom: 1 },
			b: { left: 0.5, top: 0, right: 1, bottom: 1 },
		});
	});

	it("lines up ends closer than the tolerance, moving every edge on them", () => {
		const screen: Screen = {
			areas: [
				area("a", 0, 0, 0.5, 0.5),
				area("b", 0.5, 0, 1, 0.52),
				area("c", 0, 0.5, 0.5, 1),
				area("d", 0.5, 0.52, 1, 1),
			],
		};
		const joined = rects(joinAreas(screen, "a", "b", TOLERANCE, ids()));
		expect(joined.a).toEqual({ left: 0, top: 0, right: 1, bottom: 0.51 });
		expect(joined.c?.top).toBe(0.51);
		expect(joined.d?.top).toBe(0.51);
	});

	it("cuts the kept area's overhang off and gives it to the neighbours", () => {
		const joined = rects(joinAreas(T_LAYOUT, "a", "b", TOLERANCE, ids()));
		expect(joined).toEqual({
			a: { left: 0, top: 0, right: 1, bottom: 0.5 },
			c: { left: 0, top: 0.5, right: 1, bottom: 1 },
		});
	});

	it("keeps the removed area's overhang as an area of its own, with its editor", () => {
		const screen: Screen = {
			areas: [
				{ ...area("a", 0, 0, 0.5, 1), editor: { type: "timeline" } },
				...T_LAYOUT.areas.slice(1),
			],
		};
		const joined = joinAreas(screen, "b", "a", TOLERANCE, ids());
		expect(rects(joined)).toEqual({
			b: { left: 0, top: 0, right: 1, bottom: 0.5 },
			c: { left: 0.5, top: 0.5, right: 1, bottom: 1 },
			"new-0": { left: 0, top: 0.5, right: 0.5, bottom: 1 },
		});
		expect(joined?.areas.find((a) => a.id === "new-0")?.editor.type).toBe("timeline");
	});

	it("refuses areas that aren't neighbours", () => {
		const screen: Screen = {
			areas: [area("a", 0, 0, 0.3, 1), area("b", 0.3, 0, 0.6, 1), area("c", 0.6, 0, 1, 1)],
		};
		expect(joinAreas(screen, "a", "c", TOLERANCE, ids())).toBeUndefined();
	});
});

describe("closeArea", () => {
	it("lets the best aligned neighbour take its place", () => {
		expect(rects(closeArea(T_LAYOUT, "b", TOLERANCE, ids()))).toEqual({
			a: { left: 0, top: 0, right: 0.5, bottom: 1 },
			c: { left: 0.5, top: 0, right: 1, bottom: 1 },
		});
	});

	it("never closes the last area", () => {
		expect(
			closeArea({ areas: [area("a", 0, 0, 1, 1)] }, "a", TOLERANCE, ids()),
		).toBeUndefined();
	});
});

describe("dockArea", () => {
	it("moves an editor into a new part of another area, which takes the closed one's place", () => {
		const screen: Screen = {
			areas: [
				{ ...area("a", 0, 0, 0.5, 1), editor: { type: "timeline" } },
				area("b", 0.5, 0, 1, 1),
			],
		};
		const docked = dockArea(screen, "a", "b", "bottom", 0.25, TOLERANCE, ids());
		expect(docked?.areas.map((a) => [a.id, a.rect, a.editor.type])).toEqual([
			["b", { left: 0, top: 0, right: 1, bottom: 0.75 }, "preview"],
			["new-0", { left: 0, top: 0.75, right: 1, bottom: 1 }, "timeline"],
		]);
	});

	it("replaces the target's editor in its centre", () => {
		const screen: Screen = {
			areas: [
				{ ...area("a", 0, 0, 0.5, 1), editor: { type: "timeline" } },
				area("b", 0.5, 0, 1, 1),
			],
		};
		const docked = dockArea(screen, "a", "b", "center", 0.5, TOLERANCE, ids());
		expect(docked?.areas).toEqual([
			{
				id: "b",
				rect: { left: 0, top: 0, right: 1, bottom: 1 },
				editor: { type: "timeline" },
			},
		]);
	});
});

describe("edges", () => {
	const GRID: Screen = {
		areas: [
			area("tl", 0, 0, 0.5, 0.5),
			area("tr", 0.5, 0, 1, 0.5),
			area("wide", 0, 0.5, 1, 0.7),
			area("bl", 0, 0.7, 0.4, 1),
			area("br", 0.4, 0.7, 1, 1),
		],
	};

	it("picks the sides connected to the one under the pointer", () => {
		const edge = edgeAt(T_LAYOUT, 0.5, 0.2, { width: 0.01, height: 0.01 });
		expect(edge?.axis).toBe("x");
		expect(edge?.sides).toEqual([
			{ area: "a", side: "right" },
			{ area: "b", side: "left" },
			{ area: "c", side: "left" },
		]);
	});

	it("stops at an area spanning across, unless extended", () => {
		const threshold = { width: 0.01, height: 0.01 };
		const edge = edgeAt(GRID, 0.5, 0.2, threshold);
		expect(edge?.sides.map((s) => s.area)).toEqual(["tl", "tr"]);
		const moved = edge ? moveEdge(GRID, edge, 0.3, NONE) : GRID;
		expect(rects(moved).tl?.right).toBe(0.3);
		expect(rects(moved).bl?.right).toBe(0.4);
	});

	it("clamps moves to keep areas at least the minimum size", () => {
		const edge = edgeAt(T_LAYOUT, 0.5, 0.2, { width: 0.01, height: 0.01 });
		if (!edge) throw new Error("no edge");
		expect(rects(moveEdge(T_LAYOUT, edge, 0.99, TOLERANCE)).b?.left).toBe(0.95);
	});

	it("ignores the window's border", () => {
		expect(edgeAt(T_LAYOUT, 0, 0.5, { width: 0.01, height: 0.01 })).toBeUndefined();
	});
});

describe("swapAreas", () => {
	it("exchanges editors, keeping the rectangles", () => {
		const screen: Screen = {
			areas: [
				{ ...area("a", 0, 0, 0.5, 1), editor: { type: "timeline" } },
				area("b", 0.5, 0, 1, 1),
			],
		};
		expect(swapAreas(screen, "a", "b").areas.map((a) => a.editor.type)).toEqual([
			"preview",
			"timeline",
		]);
	});
});
