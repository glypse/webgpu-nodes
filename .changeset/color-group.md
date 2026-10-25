---
"$editor": minor
---

Add a Color node, a standard-library group: pick RGB, HSV or OKLch, each with its own inputs (Red, Green, Blue; Hue, Saturation, Value; Lightness, Chroma, Hue) and an alpha, and get both the colour (vec3f) and the colour with alpha (vec4f). Only the picked mode's conversion is computed, and OKLch colours outside sRGB are mapped into it as CSS Color 4 does, keeping their lightness and hue and lowering their chroma. Unlinked, the components are edited with a hue / saturation wheel and value ramp drawn on the node, showing the mapped colour, and changing the mode converts them so the colour stays the same; a clone (Clone & Edit) is an ordinary group, without the wheel.
