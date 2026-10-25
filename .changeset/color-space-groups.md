---
"$editor": minor
---

Add colour space conversions to the standard library: Linear RGB to and from XYZ, OKLab and OKLch, XYZ to and from OKLab, and OKLab to and from OKLch (hue in degrees). Every route to OKLab gives the same result as the colour picker. OKLch Gamut Map turns an OKLch colour into linear RGB within sRGB as CSS Color 4 does, and In sRGB Gamut tells whether a colour is within it.
