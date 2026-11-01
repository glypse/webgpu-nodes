---
"$core": minor
---

Voronoi Texture and Fractal Voronoi measure Distance to Edge, F2 Distance to Edge and Radius in the chosen metric, instead of mixing Euclidean bisectors with the metric's nearest points (which drew squares at cell corners). Edges now follow the metric's own cells: exact for Euclidean, Manhattan and Chebyshev, and for Minkowski exact on the edges but approximate away from them. A new Voronoi Bisector Distance helper measures the distance to the edge between two points in any metric.
