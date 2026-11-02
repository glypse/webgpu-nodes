// OpenSimplex2's variants and lattice orientations: how coordinates are
// turned into lattice space, so the slices one looks at avoid its axes.
import type { WgslType } from "../../../../../src/types";
import {
	type EnumRef,
	group,
	type GroupBuilder,
	type Ref,
	type VariableType,
} from "../../../builder";
import { padVector } from "../../vector";
import { coordinatesType } from "../coordinates";
import { SIMPLEX_HELPERS } from "./kernel";

const VARIANTS = [
	[0, "Fast"],
	[1, "Smooth"],
] as const;
export const FAST = 0;
export const SMOOTH = 1;

/** Each dimension count's orientations, in the order its maps are listed below. */
const ORIENTATIONS = {
	2: [
		[0, "Standard"],
		[1, "Y Vertical"],
	],
	3: [
		[0, "XY Plane"],
		[1, "XZ Plane"],
		[2, "Classic"],
	],
	4: [
		[0, "XY Plane"],
		[1, "XZ Plane"],
		[2, "XYZ Volume"],
		[3, "XY and ZW Planes"],
		[4, "Classic"],
	],
} as const;

/**
 * Variant, on a group whose coordinates are `t`: shown for 2D and up, as
 * 1D noise has a single lattice.
 */
export function variantInput(g: GroupBuilder, t?: VariableType): EnumRef {
	return g.enum("variant", VARIANTS, SMOOTH, {
		label: "Variant",
		...(t ? { typeOwner: { variable: t, types: ["vec2f", "vec3f", "vec4f"] } } : {}),
	});
}

export type OrientationInputs = {
	orientation2d: EnumRef;
	orientation3d: EnumRef;
	orientation4d: EnumRef;
};

/**
 * An Orientation per dimension count, each shown only for coordinates `t`
 * of its own, as the slices worth favouring differ (and 1D has none).
 */
export function orientationInputs(g: GroupBuilder, t: VariableType): OrientationInputs {
	const input = (n: 2 | 3 | 4, type: WgslType) =>
		g.enum(`orientation${String(n)}d`, ORIENTATIONS[n], 0, {
			label: "Orientation",
			typeOwner: { variable: t, types: [type] },
		});
	return {
		orientation2d: input(2, "vec2f"),
		orientation3d: input(3, "vec3f"),
		orientation4d: input(4, "vec4f"),
	};
}

type Vector = number[];
/** A linear map, by what it makes of `v`. */
type Map = (v: Vector) => Vector;

const SKEW_2D = 0.366025403784439;
const ROOT2OVER2 = 0.7071067811865476;
const ROOT3OVER3 = 0.577350269189626;
const ORTHOGONALIZER = -0.21132486540518713;

// After OpenSimplex2's noise2, noise3_* and noise4_* (OpenSimplex2.java,
// OpenSimplex2S.java), each taking coordinates to its lattice's space.

const planeStandard: Map = ([x = 0, y = 0]) => {
	const s = SKEW_2D * (x + y);
	return [x + s, y + s];
};
const planeImproveX: Map = ([x = 0, y = 0]) => {
	const xx = x * ROOT2OVER2;
	const yy = y * ROOT2OVER2 * (1 + 2 * SKEW_2D);
	return [yy + xx, yy - xx];
};

/** Z up the cubes' main diagonal, XY far from their faces. */
const spaceImproveXY: Map = ([x = 0, y = 0, z = 0]) => {
	const s2 = (x + y) * ORTHOGONALIZER;
	const zz = z * ROOT3OVER3;
	return [x + s2 + zz, y + s2 + zz, (x + y) * -ROOT3OVER3 + zz];
};
const spaceImproveXZ: Map = ([x = 0, y = 0, z = 0]) => {
	const [xr = 0, zr = 0, yr = 0] = spaceImproveXY([x, z, y]);
	return [xr, yr, zr];
};
const spaceClassic: Map = ([x = 0, y = 0, z = 0]) => {
	const r = (2 / 3) * (x + y + z);
	return [r - x, r - y, r - z];
};

/** The 4D orientations of a variant, whose lattices differ. */
function hyper(variant: number) {
	const fast = variant === FAST;
	const wScale = fast ? 0.2236067977499788 : 1.118033988749894;
	const improveXYZ_XY: Map = ([x = 0, y = 0, z = 0, w = 0]) => {
		const s2 = (x + y) * ORTHOGONALIZER;
		const zz = z * 0.2886751345948129;
		const ww = w * wScale;
		return [
			x + zz + ww + s2,
			y + zz + ww + s2,
			(x + y) * -0.577350269189626 + zz + ww,
			z * -0.866025403784439 + ww,
		];
	};
	const improveXYZ_XZ: Map = ([x = 0, y = 0, z = 0, w = 0]) => {
		const [xr = 0, zr = 0, yr = 0, wr = 0] = improveXYZ_XY([x, z, y, w]);
		return [xr, yr, zr, wr];
	};
	const improveXYZ: Map = ([x = 0, y = 0, z = 0, w = 0]) => {
		const xyz = x + y + z;
		const ww = w * wScale;
		const s2 = xyz * (-1 / 6) + ww;
		return [x + s2, y + s2, z + s2, -0.5 * xyz + ww];
	};
	const [a, b, c, d] = fast
		? [-0.17827565795139938, 0.21562339328884284, -0.4039497625802071, -0.3751990830100753]
		: [-0.2852251398743488, 0.8389706547061143, 0.21939749883706436, -0.48214856493302477];
	const improveXY_ZW: Map = ([x = 0, y = 0, z = 0, w = 0]) => {
		const s2 = (x + y) * a + (z + w) * b;
		const t2 = (z + w) * c + (x + y) * d;
		return [x + s2, y + s2, z + t2, w + t2];
	};
	const skew = fast ? -0.138196601125011 : 0.309016994374947;
	const classic: Map = (v) => {
		const s = skew * v.reduce((sum, n) => sum + n, 0);
		return v.map((n) => n + s);
	};
	return [improveXYZ_XY, improveXYZ_XZ, improveXYZ, improveXY_ZW, classic];
}

const PLANE = [planeStandard, planeImproveX];
const SPACE = [spaceImproveXY, spaceImproveXZ, spaceClassic];

const TYPES: Record<number, WgslType> = { 2: "vec2f", 3: "vec3f", 4: "vec4f" };
const COMPONENTS = ["x", "y", "z", "w"] as const;

export const simplexOrientation = group({
	id: "std-opensimplex-orientation",
	inputs: ["vector", "variant", "orientation2d", "orientation3d", "orientation4d"],
	outputs: ["lattice"],
	name: "OpenSimplex Orientation",
	aliases: ["Lattice Orientation", "Simplex Skew", "Lattice Space", "Slice Orientation"],
	category: "texture",
	...SIMPLEX_HELPERS,
	build: (g) => {
		const t = coordinatesType(g);
		const vector = g.input("vector", t, { label: "Vector" });
		const variant = variantInput(g, t);
		const { orientation2d, orientation3d, orientation4d } = orientationInputs(g, t);
		// Split padded so every width finds its components on the same node.
		const { padded } = g.call(padVector, { vector });
		const components = g.separateVector(padded);
		// Each map once, however many orientations share it.
		const applied = new Map<Map, Ref>();
		/** `map` as a sum of its columns, each scaled by a component of the vector. */
		const apply = (map: Map, n: number): Ref => {
			const done = applied.get(map);
			if (done) return done;
			const type = TYPES[n] ?? "vec4f";
			const columns = Array.from({ length: n }, (_, i) => {
				const unit = Array.from({ length: n }, (_, j) => Number(i === j));
				const column = map(unit);
				const value: Record<string, number> = Object.fromEntries(
					column.map((c, j) => [COMPONENTS[j] ?? "x", c]),
				);
				return g.mul(components[COMPONENTS[i] ?? "x"], g.constant(type, value));
			});
			const ref = g.add(...columns);
			applied.set(map, ref);
			return ref;
		};
		const pick = (orientation: EnumRef, maps: Map[], n: number) =>
			g.match(orientation, Object.fromEntries(maps.map((m, i) => [i, apply(m, n)])));
		const plane = g.frame(
			"2D",
			{
				note: "Skewed onto the triangular lattice; Y Vertical turns it so Y runs\nalong a diagonal, for side views where Y is up.",
			},
			() => pick(orientation2d, PLANE, 2),
		);
		const space = g.frame(
			"3D",
			{
				note: "Rotated, never skewed. XY Plane puts Z up the cubes' diagonal,\nso XY slices (Z as time or height) look their best; XZ Plane\ndoes it for Y; Classic is the diagonal rotation, more biased.",
			},
			() => pick(orientation3d, SPACE, 3),
		);
		const fourD = g.frame(
			"4D",
			{
				note: "XYZ oriented as in 3D with W apart (XY Plane, XZ Plane, XYZ Volume),\nor XY and ZW as two planes (for noise(x, y, cos t, sin t));\nthe variants' lattices differ, and so do their maps.",
			},
			() =>
				g.match(variant, {
					[FAST]: pick(orientation4d, hyper(FAST), 4),
					[SMOOTH]: pick(orientation4d, hyper(SMOOTH), 4),
				}),
		);
		const lattice = g.match(
			g.componentCount(vector),
			{ 1: g.vec("vec4f", vector, 0, 0, 0), 2: plane, 3: space, 4: fourD },
			"vec4f",
		);
		g.output("lattice", lattice, t, { label: "Lattice Position" });
	},
});
