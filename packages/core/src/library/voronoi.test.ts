import { describe, expect, it } from "vitest";

import { evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, managerFor } from "../testing/graph";
import type { InputValue } from "../types";

// The Voronoi groups against a direct port of Blender's Voronoi texture
// (intern/cycles/kernel/svm/voronoi.h), hashing cells as the groups do.

const VORONOI = libraryEntry("std-voronoi-texture");
const FRACTAL = libraryEntry("std-fractal-voronoi");
const HASH = libraryEntry("std-hash");

/** PCG4D, as std-hash computes it: components in [0, 1]. */
function hash(cell: readonly number[], seed: number): number[] {
	const v = [0, 1, 2, 3].map((i) => (Math.imul(cell[i] ?? 0, 1664525) + 1013904223 + seed) | 0);
	const round = () => {
		v[0] = ((v[0] ?? 0) + Math.imul(v[1] ?? 0, v[3] ?? 0)) | 0;
		v[1] = ((v[1] ?? 0) + Math.imul(v[2] ?? 0, v[0])) | 0;
		v[2] = ((v[2] ?? 0) + Math.imul(v[0], v[1])) | 0;
		v[3] = ((v[3] ?? 0) + Math.imul(v[1], v[2])) | 0;
	};
	round();
	for (let i = 0; i < 4; i++) v[i] = (v[i] ?? 0) ^ ((v[i] ?? 0) >> 16);
	round();
	return v.map((n) => (n & 0x7fffffff) / 2147483647);
}

const COLOR_SALT = 1540483477;
const sub = (a: number[], b: number[]) => a.map((n, i) => n - (b[i] ?? 0));
const add = (a: number[], b: number[]) => a.map((n, i) => n + (b[i] ?? 0));
const scaled = (a: number[], s: number) => a.map((n) => n * s);
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * (b[i] ?? 0), 0);
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const mixed = (a: number[], b: number[], t: number) => a.map((n, i) => mix(n, b[i] ?? 0, t));

/** The offsets of a cell's neighbors within `radius`, x varying fastest. */
function neighbors(dimensions: number, radius: number): number[][] {
	let offsets: number[][] = [[]];
	for (let d = 0; d < dimensions; d++) {
		const next: number[][] = [];
		for (let o = -radius; o <= radius; o++) for (const rest of offsets) next.push([...rest, o]);
		offsets = next;
	}
	return offsets;
}

type Params = { scale: number; randomness: number; smoothness: number; seed: number };

/** Blender's Voronoi features at `coordinates` (Euclidean), every output at once. */
function reference(coordinates: number[], p: Params) {
	const dims = coordinates.length;
	const position = scaled(coordinates, p.scale);
	const cell = position.map(Math.floor);
	const local = sub(position, cell);
	const pad = (v: number[]) => [...v, ...Array<number>(4 - dims).fill(0)];
	const pointAt = (offset: number[]) =>
		add(offset, scaled(hash(pad(add(cell, offset)), p.seed).slice(0, dims), p.randomness));
	const colorAt = (offset: number[]) =>
		hash(pad(add(cell, offset)), p.seed ^ COLOR_SALT).slice(0, 3);
	const distance = (a: number[], b: number[]) => Math.sqrt(dot(sub(a, b), sub(a, b)));

	let [d1, d2] = [1e10, 1e10];
	let [p1, p2, o1, o2] = [local, local, local, local];
	for (const offset of neighbors(dims, 1)) {
		const point = pointAt(offset);
		const d = distance(point, local);
		if (d < d1) {
			[d2, p2, o2] = [d1, p1, o1];
			[d1, p1, o1] = [d, point, offset];
		} else if (d < d2) {
			[d2, p2, o2] = [d, point, offset];
		}
	}

	/** The distance to the closest bisector of `point` and another point. */
	const edgeOf = (point: number[]) => {
		const from = sub(point, local);
		let edge = 1e10;
		for (const offset of neighbors(dims, 1)) {
			const toPoint = sub(pointAt(offset), local);
			const across = sub(toPoint, from);
			if (dot(across, across) > 0.0001) {
				const normal = scaled(across, 1 / Math.sqrt(dot(across, across)));
				edge = Math.min(edge, Math.abs(dot(scaled(add(from, toPoint), 0.5), normal)));
			}
		}
		return edge;
	};

	let nearest = p1;
	let nearestSq = 1e10;
	for (const offset of neighbors(dims, 1)) {
		if (offset.every((o) => o === 0)) continue;
		const point = pointAt(add(o1, offset));
		const between = sub(p1, point);
		if (dot(between, between) < nearestSq)
			[nearestSq, nearest] = [dot(between, between), point];
	}

	const smoothness = Math.min(Math.max(p.smoothness / 2, 0), 0.5);
	let smooth = 0;
	let smoothColor = [0, 0, 0];
	let h = -1;
	for (const offset of neighbors(dims, 2)) {
		const d = distance(pointAt(offset), local);
		const t = Math.min(1, Math.max(0, 0.5 + (0.5 * (smooth - d)) / smoothness));
		h = h === -1 ? 1 : t * t * (3 - 2 * t);
		let correction = smoothness * h * (1 - h);
		smooth = mix(smooth, d, h) - correction;
		correction /= 1 + 3 * smoothness;
		smoothColor = mixed(smoothColor, colorAt(offset), h).map((c) => c - correction);
	}

	return {
		distance: d1,
		color: colorAt(o1),
		position: scaled(add(cell, p1), 1 / p.scale),
		f2Distance: d2,
		f2Position: scaled(add(cell, p2), 1 / p.scale),
		f2Color: colorAt(o2),
		smoothDistance: smooth,
		smoothColor,
		edge: edgeOf(p1),
		f2Edge: edgeOf(p2),
		radius: distance(nearest, p1) / 2,
	};
}

const VECTOR_LABELS = ["W", "Vector", "Vector", "Vector"];

/** The id of the coordinates input of `dimensions` on a noise group. */
function coordinatesInput(entry: typeof VORONOI, dimensions: number): string {
	const node = entry.definition.nodes.find((n) => n.type === "group-input");
	const handle = node?.data.handles?.find(
		(h) => h.label === VECTOR_LABELS[dimensions - 1] && h.owner?.value === dimensions,
	);
	if (!handle) throw new Error(`no ${String(dimensions)}D coordinates`);
	return handle.id;
}

function sample(
	entry: typeof VORONOI,
	coordinates: number[],
	values: Record<string, InputValue>,
	output: string,
): number[] {
	const dims = coordinates.length;
	const [x = 0, y = 0, z = 0, w = 0] = coordinates;
	const graph = managerFor(
		[
			{
				id: "v",
				type: "node-group",
				group: { definitionRef: entry.ref, locked: true },
				data: {
					values: {
						[libraryHandle(entry, "group-input", "Dimensions")]: dims,
						[coordinatesInput(entry, dims)]: dims === 1 ? x : { x, y, z, w },
						...Object.fromEntries(
							Object.entries(values).map(([label, v]) => [
								libraryHandle(entry, "group-input", label),
								v,
							]),
						),
					},
				},
			},
		],
		[],
	);
	return evaluate(graph, "v", libraryHandle(entry, "group-output", output));
}

const PARAMS: Params = { scale: 3, randomness: 0.8, smoothness: 0.6, seed: 7 };
const INPUTS = {
	Scale: PARAMS.scale,
	Randomness: PARAMS.randomness,
	Smoothness: PARAMS.smoothness,
	Seed: PARAMS.seed,
};
const POINTS = [[0.37], [0.37, -1.21], [0.37, -1.21, 2.05], [0.37, -1.21, 2.05, 0.6]];

function expectClose(actual: number[], expected: number[]) {
	expect(actual).toHaveLength(expected.length);
	expected.forEach((n, i) => {
		expect(actual[i]).toBeCloseTo(n, 5);
	});
}

describe("Hash", () => {
	it("computes PCG4D", () => {
		const graph = managerFor(
			[
				{
					id: "h",
					type: "node-group",
					group: { definitionRef: HASH.ref, locked: true },
					data: {
						values: {
							[libraryHandle(HASH, "group-input", "Value")]: {
								x: -3,
								y: 12,
								z: 0,
								w: 99,
							},
							[libraryHandle(HASH, "group-input", "Seed")]: 5,
						},
					},
				},
			],
			[],
		);
		const result = evaluate(graph, "h", libraryHandle(HASH, "group-output", "Hash"));
		expectClose(result, hash([-3, 12, 0, 99], 5));
	});
});

describe("Voronoi Texture", () => {
	describe.each(POINTS.map((p) => [p.length, p] as const))("in %iD", (dims, coordinates) => {
		const expected = reference(coordinates, PARAMS);
		const at = (output: string) => sample(VORONOI, coordinates, INPUTS, output);

		it("finds the closest two points", () => {
			expect(at("Distance")[0]).toBeCloseTo(expected.distance, 5);
			expect(at("F2 Distance")[0]).toBeCloseTo(expected.f2Distance, 5);
			expectClose(at("Position").slice(0, dims), expected.position);
			expectClose(at("F2 Position").slice(0, dims), expected.f2Position);
			expectClose(at("Color"), expected.color);
			expectClose(at("F2 Color"), expected.f2Color);
		});

		it("measures the distance to the closest two cells' edges", () => {
			expect(at("Distance to Edge")[0]).toBeCloseTo(expected.edge, 5);
			expect(at("F2 Distance to Edge")[0]).toBeCloseTo(expected.f2Edge, 5);
		});

		it("measures the closest cell's n-sphere radius", () => {
			expect(at("Radius")[0]).toBeCloseTo(expected.radius, 5);
		});

		it("smooths the closest distance", () => {
			expect(at("Smooth Distance")[0]).toBeCloseTo(expected.smoothDistance, 5);
			expectClose(at("Smooth Color"), expected.smoothColor);
		});
	});

	it("gives F1 for the smooth outputs without smoothness", () => {
		const coordinates = POINTS[1] ?? [];
		const inputs = { ...INPUTS, Smoothness: 0 };
		expect(sample(VORONOI, coordinates, inputs, "Smooth Distance")).toEqual(
			sample(VORONOI, coordinates, inputs, "Distance"),
		);
	});
});

describe("Fractal Voronoi", () => {
	const coordinates = POINTS[1] ?? [];
	const at = (inputs: Record<string, InputValue>, output: string) =>
		sample(FRACTAL, coordinates, { ...INPUTS, ...inputs }, output)[0] ?? 0;

	it("is one Voronoi octave without detail", () => {
		expect(at({ Detail: 0 }, "Distance")).toBeCloseTo(
			reference(coordinates, PARAMS).distance,
			5,
		);
	});

	it("sums octaves, the last one weighted by detail's fraction", () => {
		const octave = (i: number) =>
			reference(coordinates, { ...PARAMS, scale: PARAMS.scale * 2 ** i }).distance;
		const expected = octave(0) + 0.5 * octave(1) + 0.25 * 0.5 * octave(2);
		expect(at({ Detail: 1.5, Roughness: 0.5, Lacunarity: 2 }, "Distance")).toBeCloseTo(
			expected,
			5,
		);
	});

	it("normalizes by the total amplitude and the farthest a point can be", () => {
		const raw = at({ Detail: 1.5 }, "Distance");
		const farthest = Math.sqrt(2) * (0.5 + 0.5 * PARAMS.randomness);
		expect(at({ Detail: 1.5, Normalize: true }, "Distance")).toBeCloseTo(
			raw / ((1 + 0.5 + 0.125) * farthest),
			5,
		);
	});

	it("keeps the closest edge across octaves", () => {
		const edge = (i: number) =>
			reference(coordinates, { ...PARAMS, scale: PARAMS.scale * 2 ** i }).edge / 2 ** i;
		const first = edge(0);
		const expected = mix(first, Math.min(first, edge(1)), 0.5);
		expect(at({ Detail: 1, Roughness: 0.5 }, "Distance to Edge")).toBeCloseTo(expected, 5);
	});
});
