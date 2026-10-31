---
"$core": minor
"$runtime": minor
"$web": minor
---

In a Display P3 project, OKLch colours now keep their Display P3 saturation in the preview and PNG exports instead of being mapped into sRGB: the Color node, OKLch Gamut Map and In Display Gamut (formerly In sRGB Gamut) fit colours to the gamut of what's drawn, Display P3 on a P3 canvas and sRGB in videos. A new Clip to Display Gamut node clamps a colour to that gamut.
