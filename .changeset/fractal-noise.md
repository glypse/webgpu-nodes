---
"$core": minor
---

New Fractal Noise and OpenSimplex Noise textures, built on OpenSimplex2 (K.jpg's, public domain): 2D, 3D or 4D from the Vector's type, plain gradient noise for a scalar. Variant picks Smooth (OpenSimplex2S, the default) or Fast (OpenSimplex2); Orientation turns the lattice so the slices looked at avoid its axes: XY Plane (Z as time or height), XZ Plane (Y vertical), XYZ Volume (W as time), XY and ZW Planes (for noise(x, y, cos t, sin t)) or Classic. Fractal Noise sums octaves as Blender's Noise Texture does, in its five types (fBm, Multifractal, Hybrid Multifractal, Heterogeneous Terrain, Ridged Multifractal), with Offset, Gain, Distortion and a Color output; each octave is moved at random so their lattices don't line up.
