---
"$editor": minor
---

Add a Curve node, mapping each component of a float or float vector through a curve drawn on the node, as Blender's Float Curve does. Click the curve to add a point on it without changing its shape, Ctrl-click to add one anywhere, drag points and the selected point's handles (Ctrl snaps to a grid, Shift moves finely), and Delete removes the selected point. Each point is Vector (no handles, so segments between two of them are straight), Free, Aligned (opposite handles, each with its length) or Mirrored (opposite handles of the same length), and its position and its handles' can be typed. Presets sit beside the graph, and two buttons flip the curve left to right or upside down. Its Factor mixes the value with its mapping: scrubbing goes from 0 to 1, while typing accepts any value from 0, exaggerating the mapping past 1. Moving points doesn't recompile the shader.
