---
"$core": minor
"$editor": minor
"$theme": minor
---

Add a Color Ramp node, after Blender's: a factor picks a colour along stops drawn on a gradient on the node. Each stop's colour is an input of its own (RGB, or RGBA once one is), so stops can be linked as well as picked. Drag a stop to move it (Shift for precision, Ctrl to snap), Ctrl-click or double-click the gradient to add one, and Delete removes the selected one; the + button adds a stop between the selected one and the next, and others flip the ramp or space its stops evenly. Colours are interpolated in RGB, HSV or OKLch, with any interpolation in any space: Linear, Ease, Smooth (a monotone curve through every stop that never overshoots), Cardinal, B-Spline or Constant. In HSV and OKLch the hue goes the shorter or longer way around, or always increases or decreases; a grey stop takes its neighbour's hue rather than adding one. The interpolation, colour space and hue direction are inputs too, so groups can pass theirs on, and moving stops or editing colours doesn't recompile the shader.
