---
"$core": minor
---

Fractal Voronoi stops adding octaves once the weight of all those left falls under 1/4096, so a low Roughness with a high Detail no longer computes octaves that can't be seen (Detail 15 at Roughness 0.2 now runs 6 octaves instead of 16). The count follows Roughness as it changes, with no recompile.
