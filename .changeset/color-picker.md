---
"$core": minor
"$editor": minor
"$theme": minor
---

Add a Color node (vec3f / vec4f) and a colour input control: unlinked, its input is a swatch opening a Blender-like colour picker (hue / saturation wheel, value slider, RGB, HSV and OKLch fields, alpha, hex and a screen eyedropper where the browser has one). Colours are stored as linear RGB, what the shader computes with; hex, HSV and swatches are shown sRGB-encoded. The Output node's colour uses it too.
