---
"$core": minor
---

Add Voronoi textures under a new Texture category. Voronoi Texture works in 1D to 4D (picked with Dimensions, falling back to the UV when its coordinates are unlinked) with Euclidean, Manhattan, Chebyshev or Minkowski distances, and gives every feature at once: the closest point's distance, color, position and cell, the second closest point's, smooth F1, the distance to the cell's edge and its n-sphere radius. Fractal Voronoi sums octaves of it (Detail, Roughness, Lacunarity, Normalize). The groups they're built from are in the library too: Hash (PCG4D), Lattice Neighbor, Voronoi Point, Voronoi Distance, Fractal Octave, Noise Coordinates and Dimension Mask.
