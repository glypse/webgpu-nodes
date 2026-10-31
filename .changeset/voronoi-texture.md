---
"$core": minor
---

Add a Fractal Voronoi texture under a new Texture category. It works in 1D to 4D (picked with Dimensions, falling back to the UV when its coordinates are unlinked) with Euclidean, Manhattan, Chebyshev or Minkowski distances, sums octaves (Detail, Roughness, Lacunarity, Normalize), and gives every feature at once: the closest point's distance, color, position and cell, the second closest point's, smooth F1, the distance to the closest and second closest cells' edges, and the cell's n-sphere radius. The groups it's built from are under Texture › Helpers: Hash (PCG4D), Lattice Neighbor, Fractal Octave, Noise Coordinates and Dimension Mask, and, under Voronoi, Voronoi Texture (a single octave), Voronoi Point and Voronoi Distance.
