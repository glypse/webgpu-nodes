---
"$editor": minor
---

Add a Color node, a standard-library group: pick RGB, HSV or OKLch, each with its own inputs (Red, Green, Blue; Hue, Saturation, Value; Lightness, Chroma, Hue) and an alpha, and get both the colour (vec3f) and the colour with alpha (vec4f). Only the picked mode's conversion is computed, and OKLch colours outside sRGB are mapped into it as CSS Color 4 does, keeping their lightness and hue and lowering their chroma. Unlinked, the components are edited on the node: with a hue / saturation wheel and value ramp in RGB and HSV (locked in RGB while any component is linked), and in OKLch with a hue and chroma wheel at the colour's lightness and a lightness gauge at its chroma and hue, both drawing only the colours sRGB can show, so the gamut's shape is visible. Changing the mode converts the components so the colour stays the same; a clone (Clone & Edit) is an ordinary group, without the widget.
