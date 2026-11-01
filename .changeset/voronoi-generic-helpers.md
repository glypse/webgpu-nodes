---
"$core": minor
"$editor": minor
---

Voronoi's helper groups (Voronoi Point, Distance, Nearest Points, Bisector Distance, Edges, Radius, Smooth F1 and Lattice Neighbor) lose their Dimensions menu: like Voronoi Texture, they take their dimensions from the type of their vectors, which now have as many components as the noise has dimensions. Voronoi computes in 1D, 2D and 3D on vectors of that size instead of masked 4D ones, so it runs faster. Lattice Neighbor takes the Cell it looks around and also gives the neighbouring cell; Hash takes an integer of any width (zero past its components). Dimension Mask is gone. Links to these helpers in saved projects need redoing.

New helpers for a vector of any width: Pad to vec4f, Component Sum and Max Component. Length and Distance also take scalars.

Inside a group with shared types, a repeat zone's state item can share one of them, picked in the zone's settings: the loop then carries values of the type each group node gives it.
