---
"$core": minor
---

Voronoi Texture and Fractal Voronoi take their dimensions from what's linked to Vector: an f32 makes them 1D, a vec2f 2D, a vec3f 3D and a vec4f 4D. The Dimensions menu and its separate W input are gone; unlinked, Vector is the UV in 2D, and its type can be picked on the node. Their Position and Cell outputs now have as many components as Vector. Links to their inputs in saved projects need redoing.

A new Component Count node gives how many components its input's type has, known while compiling: a Match node can branch on it, so a group can take a different path for each vector width.
