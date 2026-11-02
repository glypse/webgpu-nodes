import { describe, expect, it } from "bun:test";

import type { StandardLibraryEntry } from "../graph/document";
import { evaluate } from "../testing/evaluate";
import { libraryEntry, libraryHandle, managerFor } from "../testing/graph";
import { hash } from "../testing/hash";
import type { InputValue, WgslType } from "../types";

// The OpenSimplex groups against a direct port of OpenSimplex2 (K.jpg's
// OpenSimplex2.java / OpenSimplex2S.java and the GLSL 3D versions), hashing
// and picking gradients as the groups do; the port against a brute-force
// sum over every lattice point within reach, so no point is ever missed.

type Vector = number[];
const FAST = 0;
const SMOOTH = 1;
const SALT = 461845907;

const add = (a: Vector, b: Vector) => a.map((n, i) => n + (b[i] ?? 0));
const sub = (a: Vector, b: Vector) => a.map((n, i) => n - (b[i] ?? 0));
const dot = (a: Vector, b: Vector) => a.reduce((sum, n, i) => sum + n * (b[i] ?? 0), 0);
const sum = (a: Vector) => a.reduce((s, n) => s + n, 0);
const unskew = (q: Vector, factor: number) => q.map((n) => n + sum(q) * factor);

function gradient(vertex: Vector, seed: number): Vector {
	const [x = 0, y = 0, z = 0] = hash(vertex.map(Math.round), seed);
	const turn = 2 * Math.PI;
	switch (vertex.length) {
		case 1:
			return [x * 2 - 1];
		case 2:
			return [Math.cos(turn * x), Math.sin(turn * x)];
		case 3: {
			const k = Math.min(Math.floor(x * 48), 47);
			const cube = [1, 2, 4].map((d) => (Math.floor(k / d) % 2) * 2 - 1);
			const edge = cube.map((c, i) => (i === Math.floor(k / 16) ? 0 : c));
			const face = Math.floor(k / 8) % 2;
			const [a = 0, b = 0, c = 0] = cube;
			const [e = 0, f = 0, h = 0] = edge;
			const cross = [b * h - c * f, c * e - a * h, a * f - b * e];
			return cube.map((n, i) => {
				const rhomb = n * (1 - face) + ((edge[i] ?? 0) + (cross[i] ?? 0)) * face;
				return ((edge[i] ?? 0) * 1.22474487139 + rhomb) * (1 - 0.042942436724648037 * face);
			});
		}
		default: {
			const [r1, r2] = [Math.sqrt(x), Math.sqrt(1 - x)];
			return [
				r1 * Math.cos(turn * y),
				r1 * Math.sin(turn * y),
				r2 * Math.cos(turn * z),
				r2 * Math.sin(turn * z),
			];
		}
	}
}

function kernel(vertex: Vector, offset: Vector, radius: number, seed: number): number {
	const falloff = Math.max(radius - dot(offset, offset), 0);
	return falloff ** 4 * dot(gradient(vertex, seed), offset);
}

const NORMALIZERS: Record<number, [number, number]> = {
	1: [3.206, 3.206],
	2: [99.28, 18.16],
	3: [32.84, 3.618],
	4: [108.7, 8.724],
};
const RADII: Record<number, [number, number]> = {
	1: [1, 1],
	2: [0.5, 2 / 3],
	3: [0.5, 0.75],
	4: [0.5, 0.8],
};
const UNSKEW_2D = -0.21132486540518713;
const UNSKEW_4D = [0.309016994374947, -0.138196601125011];
const SORTED_VERTICES = [
	[0, -1, -1, -1],
	[0, -1, 0, 0],
	[0, 0, -1, -1],
	[0, 0, -1, 0],
	[0, 0, 0, -1],
	[0, 0, 0, 0],
	[0, 0, 0, 1],
	[0, 0, 1, 0],
	[0, 1, 0, 0],
	[0, 1, 1, 0],
	[1, 0, -1, 0],
	[1, 0, 0, -1],
	[1, 0, 0, 0],
	[1, 0, 0, 1],
	[1, 0, 1, 0],
	[1, 0, 1, 1],
	[1, 1, 0, 0],
	[1, 1, 0, 1],
	[1, 1, 1, 0],
	[1, 1, 1, 1],
	[2, 1, 0, 0],
	[2, 1, 1, 0],
	[2, 1, 1, 1],
];

/** The noise at lattice position `p`, unscaled, as each variant picks its points. */
function picked(p: Vector, variant: number, seed: number): number {
	const radius = RADII[p.length]?.[variant] ?? 0;
	const base = p.map(Math.floor);
	const local = sub(p, base);
	const skewed = (offsets: Vector[], factor: number) =>
		offsets.reduce((total, o) => {
			const v = add(base, o);
			return total + kernel(v, unskew(sub(p, v), factor), radius, seed);
		}, 0);
	const [x = 0, y = 0] = local;
	switch (p.length) {
		case 1:
			return skewed([[0], [1]], 0);
		case 2: {
			if (variant === FAST)
				return skewed([[0, 0], [1, 1], y > x ? [0, 1] : [1, 0]], UNSKEW_2D);
			const xmy = x - y;
			const far = x + y > 1;
			const third = far ? (x + xmy > 1 ? [2, 1] : [0, 1]) : x + xmy < 0 ? [-1, 0] : [1, 0];
			const fourth = far ? (y - xmy > 1 ? [1, 2] : [1, 0]) : y < xmy ? [0, -1] : [0, 1];
			return skewed([[0, 0], [1, 1], third, fourth], UNSKEW_2D);
		}
		case 3:
			return [0, 1].reduce((total, copy) => {
				const q = p.map((n) => n + copy * 0.5);
				const s = seed + copy * SALT;
				const at = (v: Vector) => kernel(v, sub(q, v), radius, s);
				if (variant === FAST) {
					const closest = q.map(Math.round);
					const d = sub(q, closest);
					const a = d.map(Math.abs);
					const along = a.map((n, i) =>
						Number(n >= Math.max(a[(i + 1) % 3] ?? 0, a[(i + 2) % 3] ?? 0)),
					);
					return (
						total +
						at(closest) +
						at(closest.map((n, i) => n + (along[i] ?? 0) * Math.sign(d[i] ?? 0)))
					);
				}
				const b = q.map(Math.floor);
				const f = sub(q, b);
				const corner = (normal: Vector, bias: number, from: Vector, toward: Vector) => {
					const e = Math.floor(dot(f, normal) + bias);
					return b.map((n, i) => n + (from[i] ?? 0) + (toward[i] ?? 0) * e);
				};
				return (
					total +
					at(corner([0.25, 0.25, 0.25], 0.625, [0, 0, 0], [1, 1, 1])) +
					at(corner([-0.25, 0.25, 0.25], 0.875, [1, 0, 0], [-1, 1, 1])) +
					at(corner([0.25, -0.25, 0.25], 0.875, [0, 1, 0], [1, -1, 1])) +
					at(corner([0.25, 0.25, -0.25], 0.875, [0, 0, 1], [1, 1, -1]))
				);
			}, 0);
		default: {
			if (variant === FAST) {
				const u = UNSKEW_4D[FAST] ?? 0;
				const start = Math.floor(sum(local) * 1.25);
				let cell = local.map((n) => n - 0.2 * start);
				let diagonal = (sum(local) - 0.8 * start) * u;
				let vertex = base;
				let total = 0;
				for (let i = 0; i < 5; i++) {
					const lead = Math.max(...cell);
					if (lead >= 1 - diagonal / u) {
						const axis = cell.indexOf(lead);
						vertex = vertex.map((n, k) => n + Number(k === axis));
						cell = cell.map((n, k) => n - Number(k === axis));
						diagonal -= u;
					}
					const copy = (((start - i) % 5) + 5) % 5;
					total += kernel(
						vertex,
						cell.map((n) => n + diagonal),
						radius,
						(seed + copy * SALT) | 0,
					);
					cell = cell.map((n) => n + 0.2);
					diagonal += 0.8 * u;
					if (i === start) vertex = vertex.map((n) => n - 1);
				}
				return total;
			}
			const flipped = sum(local) > 2;
			const q = flipped ? local.map((n) => 1 - n) : local;
			const rank = q.map((n, i) => q.filter((m, j) => m > n || (m === n && j < i)).length);
			const offsets = SORTED_VERTICES.map((c) => {
				const o = rank.map((r) => c[r] ?? 0);
				return flipped ? o.map((n) => 1 - n) : o;
			});
			return skewed(offsets, UNSKEW_4D[SMOOTH] ?? 0);
		}
	}
}

/** The same sum over every lattice point near `p`. */
function brute(p: Vector, variant: number, seed: number): number {
	const n = p.length;
	const radius = RADII[n]?.[variant] ?? 0;
	const base = p.map(Math.floor);
	let offsets: Vector[] = [[]];
	for (let d = 0; d < n; d++) {
		offsets = offsets.flatMap((rest) => [-2, -1, 0, 1, 2, 3].map((o) => [...rest, o]));
	}
	const copies = n === 3 ? [0, 1] : n === 4 && variant === FAST ? [0, 1, 2, 3, 4] : [0];
	let total = 0;
	for (const copy of copies) {
		for (const o of offsets) {
			const index = add(base, o);
			if (n === 3) {
				const v = index.map((c) => c + copy * 0.5);
				total += kernel(
					add(
						index,
						index.map(() => copy),
					),
					sub(p, v),
					radius,
					seed + copy * SALT,
				);
			} else if (n === 4 && variant === FAST) {
				const v = index.map((c) => c + 0.2 * copy);
				total += kernel(
					index,
					unskew(sub(p, v), UNSKEW_4D[FAST] ?? 0),
					radius,
					(seed + copy * SALT) | 0,
				);
			} else {
				const factor = n === 2 ? UNSKEW_2D : n === 4 ? (UNSKEW_4D[SMOOTH] ?? 0) : 0;
				total += kernel(index, unskew(sub(p, index), factor), radius, seed);
			}
		}
	}
	return total;
}

/** OpenSimplex2 at lattice position `p`, in [-1, 1]. */
function reference(p: Vector, variant: number, seed: number): number {
	return picked(p, variant, seed) * (NORMALIZERS[p.length]?.[variant] ?? 0);
}

/** Deterministic pseudo-random positions in [-50, 50)ⁿ. */
function positions(dimensions: number, count: number, seed = 1): Vector[] {
	let state = seed;
	const next = () => {
		state = (Math.imul(state, 1664525) + 1013904223) | 0;
		return (state >>> 0) / 2 ** 32;
	};
	return Array.from({ length: count }, () =>
		Array.from({ length: dimensions }, () => next() * 100 - 50),
	);
}

const TYPES: Record<number, WgslType> = { 1: "f32", 2: "vec2f", 3: "vec3f", 4: "vec4f" };
const DIMENSIONS = [1, 2, 3, 4];
const VARIANTS = [FAST, SMOOTH];

const asValue = (v: Vector): InputValue =>
	v.length === 1 ? (v[0] ?? 0) : Object.fromEntries(v.map((n, i) => ["xyzw"[i] ?? "x", n]));

/** An output of a node of the library group `entry`, its inputs given by label. */
function run(
	entry: StandardLibraryEntry,
	inputs: Record<string, InputValue>,
	output: string,
	type?: WgslType,
): Vector {
	const variable = entry.definition.typeVariables?.[0]?.id;
	const handle = libraryHandle(entry, "group-output", output);
	const graph = managerFor(
		[
			{
				id: "g",
				type: "node-group",
				group: { definitionRef: entry.ref, locked: true },
				data: {
					...(variable && type ? { types: { [variable]: type } } : {}),
					// Every input of a label, as variants of an enum may each have their own.
					values: Object.fromEntries(
						Object.entries(inputs).flatMap(([label, value]) =>
							(entry.definition.inputs ?? [])
								.filter((h) => h.label === label)
								.map((h) => [h.id, value]),
						),
					),
				},
			},
		],
		[["g", handle, "out", "color"]],
	);
	return evaluate(graph, "g", handle);
}

describe("the OpenSimplex2 port", () => {
	for (const n of DIMENSIONS) {
		for (const variant of n === 1 ? [FAST] : VARIANTS) {
			it(`never misses a lattice point in ${String(n)}D ${variant === FAST ? "Fast" : "Smooth"}`, () => {
				for (const p of positions(n, n === 4 ? 40 : 150)) {
					expect(picked(p, variant, 7)).toBeCloseTo(brute(p, variant, 7), 9);
				}
			});

			it(`stays within [-1, 1] around 0 in ${String(n)}D ${variant === FAST ? "Fast" : "Smooth"}`, () => {
				const values = positions(n, 4000, 3).map((p) => reference(p, variant, 11));
				expect(Math.max(...values.map(Math.abs))).toBeLessThan(1.05);
				expect(Math.max(...values.map(Math.abs))).toBeGreaterThan(0.5);
				expect(Math.abs(sum(values) / values.length)).toBeLessThan(0.05);
			});
		}
	}
});

describe("the OpenSimplex groups", () => {
	const lattices: Record<number, StandardLibraryEntry> = {
		2: libraryEntry("std-opensimplex-2d"),
		3: libraryEntry("std-opensimplex-3d"),
		4: libraryEntry("std-opensimplex-4d"),
	};

	it("compute 1D gradient noise as the port does", () => {
		const entry = libraryEntry("std-gradient-noise-1d");
		for (const [x = 0] of positions(1, 5)) {
			const [value = 0] = run(entry, { Value: x, Seed: 5 }, "Value");
			expect(value).toBeCloseTo(reference([x], FAST, 5), 5);
		}
	});

	for (const n of [2, 3, 4]) {
		for (const variant of VARIANTS) {
			it(`compute ${String(n)}D ${variant === FAST ? "Fast" : "Smooth"} as the port does`, () => {
				const entry = lattices[n];
				if (!entry) throw new Error("no entry");
				for (const p of positions(n, 3, 9)) {
					const inputs = { "Lattice Position": asValue(p), Variant: variant, Seed: -4 };
					const [value = 0] = run(entry, inputs, "Value");
					expect(value).toBeCloseTo(reference(p, variant, -4), 5);
				}
			});
		}
	}

	it("turn 3D coordinates without skewing them, the plane's normal up the lattice's diagonal", () => {
		const entry = libraryEntry("std-opensimplex-orientation");
		const turned = (vector: Vector, orientation: number) =>
			run(
				entry,
				{ Vector: asValue(vector), Orientation: orientation },
				"Lattice Position",
				"vec3f",
			);
		const diagonal = 1 / Math.sqrt(3);
		for (const n of turned([0, 0, 1], 0)) expect(n).toBeCloseTo(diagonal, 9);
		for (const n of turned([0, 1, 0], 1)) expect(n).toBeCloseTo(diagonal, 9);
		for (const orientation of [0, 1, 2]) {
			const [v = []] = positions(3, 1, orientation);
			const length = Math.hypot(...turned(v, orientation));
			expect(length).toBeCloseTo(Math.hypot(...v), 6);
		}
	});

	it("pick the dimensions from Vector's type", () => {
		const entry = libraryEntry("std-opensimplex-noise");
		const orientation = libraryEntry("std-opensimplex-orientation");
		for (const n of DIMENSIONS) {
			const [p = []] = positions(n, 1, 21);
			const inputs = { Vector: asValue(p), Variant: SMOOTH, Orientation: 1 };
			const lattice = run(orientation, inputs, "Lattice Position", TYPES[n]);
			const [value = 0] = run(entry, { ...inputs, Seed: 2 }, "Value", TYPES[n]);
			expect(value).toBeCloseTo(reference(lattice.slice(0, n), SMOOTH, 2), 5);
		}
	});
});

describe("Fractal Noise Octaves", () => {
	const entry = libraryEntry("std-fractal-noise-octaves");
	const SKEW_2D = 0.366025403784439;
	const params = { detail: 2.5, roughness: 0.6, lacunarity: 1.9, offset: 0.7, gain: 1.4 };

	/** 2D Smooth noise at `p`, seen in the XY Plane orientation. */
	const noise = (p: Vector, seed: number) => {
		const s = SKEW_2D * sum(p);
		return reference(
			p.map((n) => n + s),
			SMOOTH,
			seed,
		);
	};

	/** Blender's fractal types over the port, octaves moved as the group moves them. */
	function fractalOf(type: number, p: Vector, seed: number): number {
		const { detail, roughness, lacunarity, offset, gain } = params;
		let value = type === 1 ? 1 : 0;
		let weight = 1;
		let total = 0;
		const octaves = Math.ceil(detail) + 1;
		for (let i = 0; i < octaves; i++) {
			const power = roughness ** i;
			const amplitude = power * Math.min(Math.max(detail - i + 1, 0), 1);
			const shift = hash([i], seed)
				.slice(0, 2)
				.map((n) => n * 128);
			const n = noise(
				add(
					p.map((c) => c * lacunarity ** i),
					shift,
				),
				seed,
			);
			if (type === 0) value += n * amplitude;
			if (type === 1) value *= n * amplitude + 1;
			if (type === 2 && weight > 0.001) {
				const w = Math.min(weight, 1);
				value += w * (n + offset) * amplitude;
				weight = w * gain * (n + offset) * power;
			}
			if (type === 3) value = i === 0 ? n + offset : value + (n + offset) * amplitude * value;
			if (type === 4) {
				const ridge = (offset - Math.abs(n)) ** 2;
				const signal = i === 0 ? ridge : ridge * Math.min(Math.max(weight * gain, 0), 1);
				value = i === 0 ? ridge : value + signal * amplitude;
				weight = signal;
			}
			total += amplitude;
		}
		return type === 0 ? (value / total) * 0.5 + 0.5 : value;
	}

	for (const [type, name] of [
		"fBm",
		"Multifractal",
		"Hybrid Multifractal",
		"Heterogeneous Terrain",
		"Ridged Multifractal",
	].entries()) {
		it(`sums the octaves as ${name}`, () => {
			for (const p of positions(2, 2, 31)) {
				const inputs = {
					Coordinates: asValue(p.map((n) => n / 10)),
					Type: type,
					Detail: params.detail,
					Roughness: params.roughness,
					Lacunarity: params.lacunarity,
					Offset: params.offset,
					Gain: params.gain,
					Normalize: true,
					Variant: SMOOTH,
					Orientation: 0,
					Seed: 3,
				};
				const [value = 0] = run(entry, inputs, "Value", "vec2f");
				expect(value).toBeCloseTo(
					fractalOf(
						type,
						p.map((n) => n / 10),
						3,
					),
					4,
				);
			}
		});
	}
});
