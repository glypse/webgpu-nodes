import * as v from "valibot";

import type { GraphDocument, StandardLibraryEntry } from "../graph/document";
import { GraphDocumentSchema, NodeWidgetSchema } from "../graph/schema";
import type { NodeWidget } from "../types";
import aspectUv from "./std-aspect-uv.json";
import color from "./std-color.json";
import componentSum from "./std-component-sum.json";
import fractalNoiseOctaves from "./std-fractal-noise-octaves.json";
import fractalNoise from "./std-fractal-noise.json";
import fractalOctave from "./std-fractal-octave.json";
import fractalVoronoi from "./std-fractal-voronoi.json";
import gradientNoise1d from "./std-gradient-noise-1d.json";
import hash from "./std-hash.json";
import inDisplayGamut from "./std-in-display-gamut.json";
import latticeGradient from "./std-lattice-gradient.json";
import latticeNeighbor from "./std-lattice-neighbor.json";
import linearRgbToOklab from "./std-linear-rgb-to-oklab.json";
import linearRgbToOklch from "./std-linear-rgb-to-oklch.json";
import linearRgbToXyz from "./std-linear-rgb-to-xyz.json";
import maxComponent from "./std-max-component.json";
import noiseCoordinates from "./std-noise-coordinates.json";
import noiseDistortion from "./std-noise-distortion.json";
import octaveShift from "./std-octave-shift.json";
import oklabToLinearRgb from "./std-oklab-to-linear-rgb.json";
import oklabToOklch from "./std-oklab-to-oklch.json";
import oklabToXyz from "./std-oklab-to-xyz.json";
import oklchGamutMap from "./std-oklch-gamut-map.json";
import oklchToLinearRgb from "./std-oklch-to-linear-rgb.json";
import oklchToOklab from "./std-oklch-to-oklab.json";
import opensimplex2d from "./std-opensimplex-2d.json";
import opensimplex3dHalf from "./std-opensimplex-3d-half.json";
import opensimplex3d from "./std-opensimplex-3d.json";
import opensimplex4d from "./std-opensimplex-4d.json";
import opensimplexNoise from "./std-opensimplex-noise.json";
import opensimplexOrientation from "./std-opensimplex-orientation.json";
import padVector from "./std-pad-vector.json";
import remap from "./std-remap.json";
import simplexKernel from "./std-simplex-kernel.json";
import voronoiBisector from "./std-voronoi-bisector.json";
import voronoiDistance from "./std-voronoi-distance.json";
import voronoiEdges from "./std-voronoi-edges.json";
import voronoiNearest from "./std-voronoi-nearest.json";
import voronoiPoint from "./std-voronoi-point.json";
import voronoiRadius from "./std-voronoi-radius.json";
import voronoiSmooth from "./std-voronoi-smooth.json";
import voronoiTexture from "./std-voronoi-texture.json";
import xyzToLinearRgb from "./std-xyz-to-linear-rgb.json";
import xyzToOklab from "./std-xyz-to-oklab.json";
import { libraryRef, libraryVersion } from "./version";
import { archivedVersions } from "./versions";

export * from "./version";

/**
 * Whether projects referencing an older version of a standard-library entry
 * get that version (loaded on demand from the archive) or the latest one.
 */
// TODO: enable once out of alpha, when old project files must keep working.
export const ARCHIVED_VERSIONS_ENABLED = false;

/** A standard-library file: a locked group definition shipped with the editor. */
export const LibraryFileSchema = v.object({
	id: v.string(),
	name: v.string(),
	/** Other names it's found by in the add menu (see `NodeDescriptor.aliases`). */
	aliases: v.optional(v.array(v.string()), []),
	category: v.string(),
	section: v.optional(v.array(v.string()), []),
	searchSection: v.optional(v.string()),
	dependencies: v.array(v.string()),
	definition: GraphDocumentSchema,
	widget: v.optional(NodeWidgetSchema),
});

/** A standard-library file as written. */
export type LibraryFile = Omit<v.InferInput<typeof LibraryFileSchema>, "definition" | "widget"> & {
	definition: GraphDocument;
	widget?: NodeWidget;
};

const files: unknown[] = [
	aspectUv,
	remap,
	color,
	linearRgbToXyz,
	xyzToLinearRgb,
	xyzToOklab,
	oklabToXyz,
	linearRgbToOklab,
	oklabToLinearRgb,
	oklabToOklch,
	oklchToOklab,
	linearRgbToOklch,
	oklchToLinearRgb,
	inDisplayGamut,
	oklchGamutMap,
	noiseCoordinates,
	hash,
	latticeNeighbor,
	voronoiPoint,
	voronoiDistance,
	voronoiTexture,
	fractalOctave,
	fractalVoronoi,
	voronoiNearest,
	voronoiEdges,
	voronoiRadius,
	voronoiSmooth,
	voronoiBisector,
	padVector,
	componentSum,
	maxComponent,
	latticeGradient,
	simplexKernel,
	opensimplexOrientation,
	gradientNoise1d,
	opensimplex2d,
	opensimplex3dHalf,
	opensimplex3d,
	opensimplex4d,
	opensimplexNoise,
	noiseDistortion,
	octaveShift,
	fractalNoiseOctaves,
	fractalNoise,
];

function toEntry(json: unknown): StandardLibraryEntry {
	const file = v.parse(LibraryFileSchema, json);
	const version = libraryVersion(file.definition);
	return {
		id: file.id,
		version,
		ref: libraryRef(file.id, version),
		label: file.name,
		aliases: file.aliases,
		category: file.category,
		section: file.section,
		...(file.searchSection ? { searchSection: file.searchSection } : {}),
		dependencies: file.dependencies,
		definition: file.definition,
		...(file.widget ? { widget: file.widget } : {}),
	};
}

/** The standard library, latest versions: group definitions every project can reference. */
export const standardLibrary: readonly StandardLibraryEntry[] = files.map(toEntry);

/** An older version of a standard-library entry, fetched from the archive. */
export async function loadArchivedVersion(ref: string): Promise<StandardLibraryEntry | undefined> {
	const load = archivedVersions[ref];
	return load ? toEntry(await load()) : undefined;
}
