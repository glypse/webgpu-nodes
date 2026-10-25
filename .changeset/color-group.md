---
"$editor": minor
---

Add a Color node, a standard-library group built from the colour space groups: pick RGB, HSV or OKLch, and get both the colour (vec3f) and the colour with alpha (vec4f). Only the picked mode's conversion is computed. Unlinked, the components are edited with a hue / saturation wheel and value ramp drawn on the node, and changing the mode converts them so the colour stays the same; a clone (Clone & Edit) is an ordinary group, without the wheel.
