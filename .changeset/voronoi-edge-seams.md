---
"$core": patch
---

Voronoi's Distance to Edge and F2 Distance to Edge no longer jump at the lattice's cell lines, a seam most visible with the Manhattan metric or Minkowski below an exponent of 2: the edges are now searched around the closest point's own cell (5×5 cells in 2D) rather than around the position's. The Voronoi Edges helper takes the F1 and F2 Offset to know those cells.
