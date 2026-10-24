---
"$core": minor
"$editor": minor
"$theme": minor
---

Add a Color node and a colour input control. The Color node (vec3f / vec4f) builds a colour from RGB, HSV or OKLch components (and alpha), each a regular input, converted to linear RGB in the shader; changing the mode converts unlinked components so the colour stays the same; unlinked, they're edited with a hue / saturation wheel and value ramp drawn on the node. The colour control turns a vec3f / vec4f input (e.g. the Output node's) into a swatch opening a compact colour picker: wheel, value ramp, RGB, HSV or OKLch fields, alpha, hex and a screen eyedropper where the browser has one. Colours are stored as linear RGB; hex, HSV and swatches are shown sRGB-encoded.
