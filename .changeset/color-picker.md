---
"$core": minor
"$editor": minor
"$theme": minor
---

Add a colour input control: it turns a vec3f / vec4f input (e.g. the Output node's) into a swatch opening a compact colour picker: RGB, HSV or OKLch fields, alpha, hex and a screen eyedropper where the browser has one, picked on a hue / saturation wheel and value ramp, or in OKLch on the Color node's gamut-aware wheel and lightness gauge. Colours are stored as linear RGB; hex, HSV and swatches are shown sRGB-encoded.
